//
//  NotificationService.m
//  SylkNotificationService
//
//  Retitles incoming Sylk message pushes with the locally-known contact
//  display name. The server only knows the bare URI, so the raw APNs
//  alert arrives titled "New message" / "From <uri>". The main app writes
//  a {uri: display_name} map to contactDisplayNames.plist in the shared
//  App Group container (APNSTokenModule.SylkWriteDisplayNamesFile, with
//  NSFileProtectionNone so it is readable here on the lock screen). This
//  extension runs for every push carrying "mutable-content": 1 and
//  rewrites the title before iOS shows the banner.
//
//  A plain file is used rather than App Group NSUserDefaults: defaults do
//  not reliably surface to an extension process and can be lock-screen
//  protected. If anything is missing (no data, no from_uri, no map
//  entry) the notification is delivered unchanged — this extension must
//  never cost the user a banner.
//
//  Logs are prefixed "[SYLK_APP] [nse]" so metro-adb-logs.sh's
//  idevicesyslog capture picks them up, and use %s + UTF8String so
//  unified logging doesn't redact the values to <private>.
//

#import "NotificationService.h"

static NSString *const kAppGroup = @"group.com.agprojects.sylk-ios";

// Reads the {uri: display_name} map the app maintains in the shared
// container. Returns nil if the file is absent or unreadable.
static NSDictionary *SylkReadDisplayNames(void) {
    NSURL *c = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kAppGroup];
    if (c == nil) { return nil; }
    NSString *path = [[c URLByAppendingPathComponent:@"contactDisplayNames.plist"] path];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (data == nil) { return nil; }
    id plist = [NSPropertyListSerialization propertyListWithData:data
                                                         options:0
                                                          format:NULL
                                                           error:NULL];
    return [plist isKindOfClass:[NSDictionary class]] ? plist : nil;
}

@interface NotificationService ()
@property (nonatomic, strong) void (^contentHandler)(UNNotificationContent *contentToDeliver);
@property (nonatomic, strong) UNMutableNotificationContent *bestAttemptContent;
@end

@implementation NotificationService

- (void)didReceiveNotificationRequest:(UNNotificationRequest *)request
                   withContentHandler:(void (^)(UNNotificationContent *_Nonnull))contentHandler
{
    self.contentHandler = contentHandler;
    self.bestAttemptContent = [request.content mutableCopy];

    @try {
        NSDictionary *data = request.content.userInfo[@"data"];
        NSString *fromUri = nil;
        if ([data isKindOfClass:[NSDictionary class]]) {
            id v = data[@"from_uri"];
            if ([v isKindOfClass:[NSString class]] && [(NSString *)v length] > 0) {
                fromUri = [v lowercaseString];
            }
        }

        if (fromUri != nil) {
            NSDictionary *names = SylkReadDisplayNames();
            id name = names[fromUri];
            if ([name isKindOfClass:[NSString class]]
                && [(NSString *)name length] > 0
                && ![name isEqualToString:fromUri]) {
                NSLog(@"[SYLK_APP] [nse] retitle '%s' -> '%s'",
                      [fromUri UTF8String], [(NSString *)name UTF8String]);
                self.bestAttemptContent.title = name;
            } else {
                NSLog(@"[SYLK_APP] [nse] no local name for '%s' (map=%lu)",
                      [fromUri UTF8String], (unsigned long)names.count);
                // No known name — show the bare URI rather than an empty
                // title, but never overwrite a title the server provided.
                if (self.bestAttemptContent.title.length == 0) {
                    self.bestAttemptContent.title = fromUri;
                }
            }
        }
        // application/sylk-request: a location / meet-up invitation whose
        // cleartext JSON body names the request_type. Rewrite the banner to
        // "Location request" / "Meeting request" (title) + "from <name>"
        // (body), mirroring the Android FCM service, instead of the generic
        // message alert. The tap still routes content/content_type into the
        // JS handler that renders the modal.
        NSString *contentType = nil;
        NSString *bodyJson = nil;
        if ([data isKindOfClass:[NSDictionary class]]) {
            id ct = data[@"content_type"];
            if ([ct isKindOfClass:[NSString class]]) contentType = (NSString *)ct;
            id cn = data[@"content"];
            if ([cn isKindOfClass:[NSString class]]) bodyJson = (NSString *)cn;
        }
        if ([contentType isEqualToString:@"application/sylk-request"]) {
            NSString *reqType = @"location";
            if (bodyJson != nil) {
                NSData *jd = [bodyJson dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *obj = jd != nil
                    ? [NSJSONSerialization JSONObjectWithData:jd options:0 error:nil] : nil;
                id rt = [obj isKindOfClass:[NSDictionary class]] ? obj[@"request_type"] : nil;
                if ([rt isKindOfClass:[NSString class]] && [(NSString *)rt isEqualToString:@"meeting"]) {
                    reqType = @"meeting";
                }
            }
            NSString *who = (self.bestAttemptContent.title.length > 0)
                ? self.bestAttemptContent.title
                : (fromUri != nil ? fromUri : @"someone");
            self.bestAttemptContent.title = [reqType isEqualToString:@"meeting"]
                ? @"Meet-up request" : @"Location request";
            self.bestAttemptContent.body = [NSString stringWithFormat:@"from %@", who];
            NSLog(@"[SYLK_APP] [nse] sylk-request banner (%s) from '%s'",
                  [reqType UTF8String], [who UTF8String]);
        }
        // application/sylk-location-sharing: a location SHARE (not a request).
        // The server only pushes ORIGIN ticks (one-shot / live / meet start),
        // so this is always a "a share just began" event. Rewrite the banner to
        // a friendly label; the coords are encrypted and never shown here, and
        // the map renders in-app once the tap opens the chat.
        else if ([contentType isEqualToString:@"application/sylk-location-sharing"]) {
            NSString *who = (self.bestAttemptContent.title.length > 0)
                ? self.bestAttemptContent.title
                : (fromUri != nil ? fromUri : @"someone");
            NSString *locAction = @"";
            NSString *locReason = @"";
            if (bodyJson != nil) {
                NSData *jd = [bodyJson dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *obj = jd != nil
                    ? [NSJSONSerialization JSONObjectWithData:jd options:0 error:nil] : nil;
                if ([obj isKindOfClass:[NSDictionary class]]) {
                    id a = obj[@"action"];
                    if ([a isKindOfClass:[NSString class]]) locAction = (NSString *)a;
                    id r = obj[@"reason"];
                    if ([r isKindOfClass:[NSString class]]) locReason = (NSString *)r;
                }
            }
            // Lead the banner with the sender's name (already set as the
            // title by the display-name retitle above) so a location share
            // reads like a normal message banner; the event is described in
            // the body. Previously the title was hard-overwritten with the
            // literal "Location", which surfaced as the caller name instead
            // of the person who shared.
            self.bestAttemptContent.title = who;
            if ([locAction isEqualToString:@"meeting_request"]) {
                // Meet-up INVITE (now carried on application/sylk-location-
                // sharing with action=="meeting_request"). Label it as a
                // meeting request, mirroring the Android FCM service. The
                // tap routes content/content_type into the app, which opens
                // the accept/decline modal + the sender's chat.
                self.bestAttemptContent.body = @"\U0001F4CD Meet-up request";
            } else if ([locAction isEqualToString:@"meeting_accept"]) {
                self.bestAttemptContent.body = @"\U0001F4CD Accepted your meet-up request";
            } else if ([locAction isEqualToString:@"meeting_end"]) {
                if ([locReason isEqualToString:@"proximity"]) {
                    self.bestAttemptContent.body = @"\U0001F389 Nice to meet you!";
                } else {
                    self.bestAttemptContent.body = @"\U0001F4CD Meet-up ended";
                }
            } else if ([locAction isEqualToString:@"location_once"]) {
                self.bestAttemptContent.body = @"\U0001F4CD Shared current location";
            } else if ([locAction isEqualToString:@"location_start"]) {
                self.bestAttemptContent.body = @"\U0001F4CD Started sharing location";
            } else if ([locAction isEqualToString:@"location_stop"]) {
                // Live trail ended — phrase by why (returned home / expired /
                // user ended). Mirrors the Android FCM service labels.
                if ([locReason isEqualToString:@"returned"]) {
                    self.bestAttemptContent.body = @"\U0001F4CD Returned home";
                } else if ([locReason isEqualToString:@"meet_end"]) {
                    self.bestAttemptContent.body = @"\U0001F4CD Meet-up ended";
                } else {
                    self.bestAttemptContent.body = @"\U0001F4CD Stopped sharing location";
                }
            } else {
                self.bestAttemptContent.body = @"\U0001F4CD Location update";
            }
            NSLog(@"[SYLK_APP] [nse] sylk-location-sharing banner action='%s' from '%s'",
                  [locAction UTF8String], [who UTF8String]);
        }
    } @catch (NSException *e) {
        NSLog(@"[SYLK_APP] [nse] exception %s — delivering unchanged",
              [(e.reason ?: @"(nil)") UTF8String]);
        // Fall through and deliver the unmodified copy.
    }

    self.contentHandler(self.bestAttemptContent);
}

- (void)serviceExtensionTimeWillExpire
{
    // Out of time — deliver the best attempt so far; iOS falls back to
    // the original payload if we never call the handler.
    self.contentHandler(self.bestAttemptContent);
}

@end
