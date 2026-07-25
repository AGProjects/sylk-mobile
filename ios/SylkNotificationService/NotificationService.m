//
//  NotificationService.m
//  SylkNotificationService
//
//  Retitles incoming Sylk message pushes with the locally-known contact
//  display name. The server only knows the bare URI (it has no realtime
//  access to the user's address book), so the raw APNs alert arrives
//  titled with e.g. "ag@sylk.link". The main app maintains a
//  {uri: display_name} dictionary in the shared app-group defaults
//  (written by APNSTokenModule.syncContactDisplayNames on every contacts
//  load, and by AppDelegate's native push-insert path for brand-new
//  senders); this extension runs for every push whose APNs payload
//  carries "mutable-content": 1 and rewrites the visible title before
//  iOS displays the banner — including on the lock screen, where no
//  other app code can run.
//
//  If anything is missing (no data dict, no from_uri, no map entry),
//  the notification is delivered unchanged — this extension must never
//  cost the user a message banner.
//

#import "NotificationService.h"

static NSString *const kAppGroup = @"group.com.agprojects.sylk-ios";
static NSString *const kDisplayNamesKey = @"contactDisplayNames";

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
        NSDictionary *userInfo = request.content.userInfo;
        NSDictionary *data = userInfo[@"data"];
        NSString *fromUri = nil;
        if ([data isKindOfClass:[NSDictionary class]]) {
            id v = data[@"from_uri"];
            if ([v isKindOfClass:[NSString class]] && [(NSString *)v length] > 0) {
                fromUri = [v lowercaseString];
            }
        }

        if (fromUri != nil) {
            NSUserDefaults *shared =
                [[NSUserDefaults alloc] initWithSuiteName:kAppGroup];
            NSDictionary *names = [shared dictionaryForKey:kDisplayNamesKey];
            id name = names[fromUri];
            if ([name isKindOfClass:[NSString class]]
                && [(NSString *)name length] > 0
                && ![name isEqualToString:fromUri]) {
                // NSLog only — the extension runs in its own process, so
                // these lines appear in Console.app (filter by process
                // SylkNotificationService), NOT in the app's log pipeline.
                NSLog(@"[nse] retitle %@ -> %@ (map has %lu entries)",
                      fromUri, name, (unsigned long)names.count);
                self.bestAttemptContent.title = name;
            } else if (self.bestAttemptContent.title.length == 0) {
                // No local name known — show the bare URI rather than an
                // empty title.
                NSLog(@"[nse] no local name for %@ (map has %lu entries), using uri as title",
                      fromUri, (unsigned long)names.count);
                self.bestAttemptContent.title = fromUri;
            } else {
                NSLog(@"[nse] no local name for %@ (map has %lu entries), keeping server title '%@'",
                      fromUri, (unsigned long)names.count, self.bestAttemptContent.title);
            }
        }
    } @catch (NSException *e) {
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
