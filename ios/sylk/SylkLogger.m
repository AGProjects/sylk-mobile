//
//  SylkLogger.m
//  sylk
//

#import "SylkLogger.h"

static NSString * const kLogFileName       = @"sylk-native.log";
static NSString * const kLogReadFileName   = @"sylk-native.log.read";
static NSString * const kLogBackupFileName = @"sylk-native.log.1";
static const unsigned long long kMaxBytes  = 512 * 1024;  // 512 KB
static NSString * const kTagPrefix         = @"[SYLK_APP] ";

// Mutated only on the SylkLogger ioQueue (set via setLiveListener:,
// read inside log:). No further synchronization needed.
static void (^_liveListener)(NSString *) = nil;

@implementation SylkLogger

#pragma mark - Paths

+ (NSString *)cachesDir
{
    static NSString *cachesDir = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        cachesDir = [NSSearchPathForDirectoriesInDomains(NSCachesDirectory,
                                                         NSUserDomainMask,
                                                         YES) firstObject];
    });
    return cachesDir;
}

+ (NSString *)logPath        { return [[self cachesDir] stringByAppendingPathComponent:kLogFileName]; }
+ (NSString *)logReadPath    { return [[self cachesDir] stringByAppendingPathComponent:kLogReadFileName]; }
+ (NSString *)logBackupPath  { return [[self cachesDir] stringByAppendingPathComponent:kLogBackupFileName]; }

#pragma mark - Serial queue

+ (dispatch_queue_t)ioQueue
{
    static dispatch_queue_t q = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        q = dispatch_queue_create("com.agprojects.sylk.logger", DISPATCH_QUEUE_SERIAL);
    });
    return q;
}

+ (NSDateFormatter *)isoFormatter
{
    static NSDateFormatter *fmt = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        fmt = [NSDateFormatter new];
        fmt.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS";
        fmt.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    });
    return fmt;
}

#pragma mark - Public API

+ (void)log:(NSString *)fmt, ...
{
    if (fmt == nil) return;

    va_list args;
    va_start(args, fmt);
    NSString *body = [[NSString alloc] initWithFormat:fmt arguments:args];
    va_end(args);

    // ONE-LINE INVARIANT (matches utils.js log2file). If a format
    // arg ever contains an embedded \r / \n / \r\n the on-disk
    // buffer would split into phantom lines without leading [tag]s
    // — those would surface as "untagged" pill entries in
    // LogsModal. Replace inline with literal " \n " so the boundary
    // is still visible and grep-friendly.
    if ([body rangeOfCharacterFromSet:[NSCharacterSet newlineCharacterSet]].location != NSNotFound) {
        NSCharacterSet *crlf = [NSCharacterSet newlineCharacterSet];
        NSArray<NSString *> *parts = [body componentsSeparatedByCharactersInSet:crlf];
        // Drop empty trailing fragment so we don't emit " \n " at end.
        NSMutableArray<NSString *> *kept = [NSMutableArray arrayWithCapacity:parts.count];
        for (NSString *part in parts) {
            if (part.length > 0) [kept addObject:part];
        }
        body = [kept componentsJoinedByString:@" \\n "];
    }

    // Live console pass-through. Use %s + UTF8String trick the rest of
    // the codebase relies on so unified-logging doesn't redact the
    // value to <private>.
    NSLog(@"%@%s", kTagPrefix, [body UTF8String]);

    // Route to disk OR live listener on the serial queue. Capture
    // body now; format the timestamp on the queue so we don't pay
    // for it in callers.
    dispatch_async([self ioQueue], ^{
        @try {
            if (_liveListener) {
                // Live mode — pass the formatted line straight to JS
                // without persisting. JS owns the line from this
                // point on; on app death any in-flight lines that
                // never reached JS are lost (they're still in
                // Console / Logcat for dev debugging).
                NSString *ts = [[self isoFormatter] stringFromDate:[NSDate date]];
                NSString *line = [NSString stringWithFormat:@"%@ | %@", ts, body];
                _liveListener(line);
            } else {
                [self appendLine:body];
            }
        } @catch (NSException *ex) {
            // Last-ditch: if the file system blew up we don't want to
            // crash the app. NSLog directly so we don't recurse.
            NSLog(@"[SYLK_APP][SylkLogger] log dispatch failed: %@", ex.reason);
        }
    });
}

+ (void)setLiveListener:(void (^)(NSString *))listener
{
    // Hop onto ioQueue so log:'s read of _liveListener never races
    // with this assignment. `copy` because the caller may pass a
    // stack block.
    void (^copied)(NSString *) = [listener copy];
    dispatch_async([self ioQueue], ^{
        _liveListener = copied;
    });
}

+ (NSString *)drainStart
{
    __block NSString *contents = @"";

    dispatch_sync([self ioQueue], ^{
        NSFileManager *fm = [NSFileManager defaultManager];
        NSString *src = [self logPath];
        NSString *dst = [self logReadPath];

        // If a previous drain didn't ack, .read still exists. Append
        // the current file to it so we don't lose either set of lines.
        if ([fm fileExistsAtPath:dst]) {
            if ([fm fileExistsAtPath:src]) {
                NSData *tail = [NSData dataWithContentsOfFile:src];
                if (tail.length > 0) {
                    NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:dst];
                    if (fh) {
                        [fh seekToEndOfFile];
                        [fh writeData:tail];
                        [fh closeFile];
                    }
                }
                [fm removeItemAtPath:src error:nil];
            }
        } else if ([fm fileExistsAtPath:src]) {
            [fm moveItemAtPath:src toPath:dst error:nil];
        }

        if ([fm fileExistsAtPath:dst]) {
            NSData *data = [NSData dataWithContentsOfFile:dst];
            if (data) {
                contents = [[NSString alloc] initWithData:data
                                                 encoding:NSUTF8StringEncoding] ?: @"";
            }
        }
    });

    return contents;
}

+ (void)drainAck
{
    dispatch_async([self ioQueue], ^{
        NSFileManager *fm = [NSFileManager defaultManager];
        NSString *p = [self logReadPath];
        if ([fm fileExistsAtPath:p]) {
            [fm removeItemAtPath:p error:nil];
        }
    });
}

#pragma mark - Internals (must run on ioQueue)

+ (void)appendLine:(NSString *)body
{
    NSString *ts = [[self isoFormatter] stringFromDate:[NSDate date]];
    NSString *line = [NSString stringWithFormat:@"%@ | %@\n", ts, body];
    NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
    if (data.length == 0) return;

    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *path = [self logPath];

    // Rotate before write if we'd exceed the cap. Single backup file —
    // older history is dropped, which is the right trade-off for
    // recent-crash diagnosis.
    if ([fm fileExistsAtPath:path]) {
        NSError *attrErr = nil;
        NSDictionary *attrs = [fm attributesOfItemAtPath:path error:&attrErr];
        unsigned long long size = [attrs fileSize];
        if (size + data.length > kMaxBytes) {
            NSString *backup = [self logBackupPath];
            if ([fm fileExistsAtPath:backup]) {
                [fm removeItemAtPath:backup error:nil];
            }
            [fm moveItemAtPath:path toPath:backup error:nil];
        }
    }

    if (![fm fileExistsAtPath:path]) {
        [fm createFileAtPath:path contents:nil attributes:nil];
    }

    NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:path];
    if (!fh) return;
    @try {
        [fh seekToEndOfFile];
        [fh writeData:data];
    } @finally {
        [fh closeFile];
    }
}

@end
