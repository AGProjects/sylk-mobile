//
//  SylkLogger.h
//  sylk
//
//  Centralised native logging sink. Wraps NSLog (so Xcode/Console keep
//  showing every line live) AND appends each line to a rotating file
//  in NSCachesDirectory. The React Native side reads that file once on
//  startup via NativeLoggerModule so the in-app log view shows what
//  happened in PushKit / VoIP / background paths BEFORE RN was running.
//
//  Two-phase drain protects against lost lines if JS crashes between
//  the bridge return and writing them to the in-app buffer:
//      1. drainStart: atomically rename current log -> .read, return
//                     contents (ignores prior .read on the floor; that
//                     only happens if a previous drain didn't ack).
//      2. drainAck:   delete the .read file. Only call after JS has
//                     successfully committed the lines.
//
//  Thread-safety: all writes go through a serial dispatch queue, so
//  concurrent log calls never interleave bytes. The OS guarantees
//  POSIX-append (O_APPEND) is atomic for short writes anyway, but the
//  serial queue keeps the rotation check race-free.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface SylkLogger : NSObject

/// printf-style log call. Equivalent to:
///     NSLog(@"[SYLK_APP] " fmt, ...)
/// AND appends "<iso8601> | <message>\n" to the on-disk buffer.
+ (void)log:(NSString *)fmt, ... NS_FORMAT_FUNCTION(1, 2);

/// Phase 1 of the read flow. Atomically renames the active log file
/// to "<file>.read" and returns its contents (or @"" if there was
/// nothing to read). Subsequent log calls go to a fresh file.
+ (NSString *)drainStart;

/// Phase 2 of the read flow. Deletes the "<file>.read" file. Safe to
/// call even if there's nothing to delete.
+ (void)drainAck;

/// Live streaming hook. While a non-nil listener is registered, every
/// log: call invokes `listener(line)` on the SylkLogger ioQueue
/// INSTEAD of appending to the rotating on-disk buffer. NSLog / Console
/// output is unaffected and continues to fire either way.
///
/// This is the subscribe-first half of the no-duplicate guarantee:
/// once JS subscribes, lines flow ONLY through the bridge, so they
/// can never end up both in a drain payload and in the live stream
/// across an app restart.
///
/// Pass nil to clear (e.g. when JS unsubscribes / the app
/// backgrounds); subsequent log: calls resume disk persistence.
+ (void)setLiveListener:(void (^_Nullable)(NSString *line))listener;

@end

NS_ASSUME_NONNULL_END
