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
@import Intents;   // INSendMessageIntent -- communication notifications

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

// Reads the set of contact URIs the app has tagged `bypassdnd`. Returns
// nil if the file is absent or unreadable, which means "nobody bypasses"
// — a missing file must never upgrade a stranger's push.
static NSSet<NSString *> *SylkReadBypassDnd(void) {
    NSURL *c = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kAppGroup];
    if (c == nil) { return nil; }
    NSString *path = [[c URLByAppendingPathComponent:@"contactBypassDnd.plist"] path];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (data == nil) { return nil; }
    id plist = [NSPropertyListSerialization propertyListWithData:data
                                                         options:0
                                                          format:NULL
                                                           error:NULL];
    if (![plist isKindOfClass:[NSArray class]]) { return nil; }
    NSMutableSet<NSString *> *set = [NSMutableSet set];
    for (id v in (NSArray *)plist) {
        if ([v isKindOfClass:[NSString class]] && [(NSString *)v length] > 0) {
            [set addObject:[(NSString *)v lowercaseString]];
        }
    }
    return set;
}

// Reads the mirrored in-app DND flag. NO when absent or unreadable, so a
// missing file can never silence anything.
static BOOL SylkReadAppDnd(void) {
    NSURL *c = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kAppGroup];
    if (c == nil) { return NO; }
    NSString *path = [[c URLByAppendingPathComponent:@"appDnd.plist"] path];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (data == nil) { return NO; }
    id plist = [NSPropertyListSerialization propertyListWithData:data
                                                         options:0
                                                          format:NULL
                                                           error:NULL];
    if (![plist isKindOfClass:[NSDictionary class]]) { return NO; }
    id v = ((NSDictionary *)plist)[@"dnd"];
    return [v respondsToSelector:@selector(boolValue)] ? [v boolValue] : NO;
}

@interface NotificationService ()
- (void)donateAndDeliverForUri:(NSString *)fromUri displayName:(NSString *)displayName;
@property (nonatomic, strong) void (^contentHandler)(UNNotificationContent *contentToDeliver);
@property (nonatomic, strong) UNMutableNotificationContent *bestAttemptContent;
@end

@implementation NotificationService

- (void)didReceiveNotificationRequest:(UNNotificationRequest *)request
                   withContentHandler:(void (^)(UNNotificationContent *_Nonnull))contentHandler
{
    self.contentHandler = contentHandler;
    self.bestAttemptContent = [request.content mutableCopy];

    // Set inside the @try, read after it. A suppressed notification must not
    // be donated: donating would tell the system this is a communication
    // worth surfacing, which is the opposite of what the bell asked for.
    __block BOOL suppressedForDnd = NO;
    __block NSString *commFromUri = nil;

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
            } else if ([locAction isEqualToString:@"location_request"]) {
                // "Please share your current location" — a coordinate-free ASK,
                // not a share. It rides application/sylk-location-sharing (see
                // sendLocationRequest in app.js) so without this branch it fell
                // through to the generic "Location update" below, which read as
                // if the sender had shared something. Mirrors the Android FCM
                // service. The tap still opens the sender's chat, where the
                // Yes/No modal is presented by the WS/journal copy.
                self.bestAttemptContent.body = @"\U0001F4CD Requests your location";
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
        // Do-Not-Disturb bypass. A notification delivered at the default
        // UNNotificationInterruptionLevelActive is exactly what a system
        // Focus / DND silences, so the app's per-contact `bypassdnd` tag
        // had no effect at all on message pushes — it was only ever read
        // on the PushKit call path (AppDelegate canBypassDnd:). Raising
        // the level to .timeSensitive here is what actually breaks a
        // message banner through.
        //
        // Requires the com.apple.developer.usernotifications.time-sensitive
        // entitlement on BOTH this extension and the containing app;
        // without it iOS silently downgrades back to .active — no error,
        // no log, which is why this is worth logging explicitly.
        //
        // Note the user still owns the final say: a Focus has a per-app
        // "Time Sensitive Notifications" toggle (on by default). If they
        // turn it off for Sylk, nothing short of .critical gets through,
        // and that needs a separate Apple-approved entitlement.
        if (fromUri != nil) {
            NSSet<NSString *> *bypass = SylkReadBypassDnd();
            BOOL bypassing = [bypass containsObject:fromUri];
            BOOL appDndOn = SylkReadAppDnd();

            // Log the gate inputs UNCONDITIONALLY, every message. Logging
            // only the branch that fires makes "the gate said no" and "this
            // build doesn't have the gate" indistinguishable in a capture —
            // which is exactly what happened chasing the app-DND case on
            // 2026-08-19. bypassSet is the entry count so a silently empty
            // or unreadable contactBypassDnd.plist shows up here too.
            NSLog(@"[SYLK_APP] [nse] gate: appDnd=%s bypassing=%s bypassSet=%lu",
                  appDndOn ? "ON" : "off",
                  bypassing ? "yes" : "no",
                  (unsigned long)bypass.count);

            // In-app DND (privacy.dnd, the navbar bell) applied to MESSAGE
            // pushes. The call paths enforce this natively, but a message
            // banner is drawn by iOS from the server's alert push and the
            // app never got a say — so with the bell on, a text still
            // popped a bubble.
            //
            // .passive delivers the notification straight to Notification
            // Center: no banner, no sound, no lock-screen wake. The message
            // is not lost, it just stops interrupting — which is what the
            // bell means. Contacts tagged bypassdnd skip this entirely and
            // go on to the time-sensitive upgrade below.
            if (!bypassing && appDndOn) {
                // Deliver CONTENT WITH NOTHING TO DISPLAY.
                //
                // .passive alone was not enough: it stops the screen waking
                // and the sound, but iOS still draws the banner while the
                // user is on the device, so a text still popped a bubble
                // with the bell on (verified 2026-08-19 14:17 -- the gate
                // fired, the banner appeared anyway).
                //
                // Apple gives a notification service extension no way to
                // cancel a push. Handing back an empty UNMutableNotification-
                // Content is the accepted workaround: no title, no body, no
                // sound means there is no alert to render. userInfo is
                // carried over so anything that inspects the payload still
                // sees it.
                //
                // This is not a documented guarantee -- it is behaviour, and
                // Apple could change it. The durable fix is server-side:
                // don't send the alert push at all when the account's DND is
                // on and the sender isn't tagged bypassdnd.
                UNMutableNotificationContent *quiet =
                    [[UNMutableNotificationContent alloc] init];
                quiet.userInfo = self.bestAttemptContent.userInfo ?: @{};
                if (@available(iOS 15.0, *)) {
                    quiet.interruptionLevel = UNNotificationInterruptionLevelPassive;
                }
                self.bestAttemptContent = quiet;
                suppressedForDnd = YES;
                NSLog(@"[SYLK_APP] [nse] app DND -- suppressing banner for '%s'",
                      [fromUri UTF8String]);
            }

            commFromUri = fromUri;

            if (bypassing) {
                if (@available(iOS 15.0, *)) {
                    self.bestAttemptContent.interruptionLevel =
                        UNNotificationInterruptionLevelTimeSensitive;
                    // Float it to the top of a grouped/summarised stack too.
                    self.bestAttemptContent.relevanceScore = 1.0;
                    NSLog(@"[SYLK_APP] [nse] dnd-bypass: time-sensitive for '%s'",
                          [fromUri UTF8String]);
                }
            }
        }
    } @catch (NSException *e) {
        NSLog(@"[SYLK_APP] [nse] exception %s -- delivering unchanged",
              [(e.reason ?: @"(nil)") UTF8String]);
        // Fall through and deliver the unmodified copy.
    }

    // Communication notification. Donating an INSendMessageIntent for the
    // sender and re-deriving the content from it is what makes iOS treat this
    // as a message from a PERSON rather than an alert from an app: contact
    // avatar in the banner, and -- the reason we are here -- eligibility for
    // Focus's per-person allow list, so one contact can break through a Focus
    // while the rest stay silent, without Blink being allow-listed wholesale.
    //
    // Skipped when the bell suppressed the notification: there is nothing to
    // decorate, and donating would assert the opposite of what DND asked for.
    if (!suppressedForDnd && commFromUri != nil) {
        [self donateAndDeliverForUri:commFromUri
                         displayName:self.bestAttemptContent.title];
        return;
    }

    self.contentHandler(self.bestAttemptContent);
}

/// Donate the interaction, then deliver content derived from it. Falls back to
/// the plain content on any failure -- a communication notification is an
/// upgrade, and never getting one must never cost the user the banner.
- (void)donateAndDeliverForUri:(NSString *)fromUri displayName:(NSString *)displayName
{
    if (@available(iOS 15.0, *)) {
        @try {
            // A Sylk address is user@domain -- exactly the shape of an email
            // handle -- so iOS matches it against the email fields of the
            // user's contact cards. That match is the whole mechanism: it is
            // what puts the sender on a contact card and makes Focus's People
            // allow list apply. Apple requires the handle type AND
            // suggestionType none together for an exact contact match.
            //
            // customIdentifier carries the URI so a sender with no contact
            // card still gets a stable identity (and a contact suggestion)
            // rather than collapsing into one anonymous person.
            INPersonHandle *handle =
                [[INPersonHandle alloc] initWithValue:fromUri
                                                 type:INPersonHandleTypeEmailAddress];
            INPerson *sender =
                [[INPerson alloc] initWithPersonHandle:handle
                                        nameComponents:nil
                                           displayName:(displayName.length > 0 ? displayName : fromUri)
                                                 image:nil
                                     contactIdentifier:nil
                                      customIdentifier:fromUri
                                                  isMe:NO
                                        suggestionType:INPersonSuggestionTypeNone];

            // content stays nil: the notification body is already set (and for
            // an encrypted message we do not have the plaintext here anyway).
            // conversationIdentifier is the peer URI, stable for a 1-to-1
            // thread, which is what groups the banners together.
            INSendMessageIntent *intent =
                [[INSendMessageIntent alloc] initWithRecipients:nil
                                            outgoingMessageType:INOutgoingMessageTypeOutgoingMessageText
                                                        content:nil
                                             speakableGroupName:nil
                                         conversationIdentifier:fromUri
                                                    serviceName:@"Sylk"
                                                         sender:sender
                                                    attachments:nil];

            INInteraction *interaction =
                [[INInteraction alloc] initWithIntent:intent response:nil];
            interaction.direction = INInteractionDirectionIncoming;

            __weak NotificationService *weakSelf = self;
            [interaction donateInteractionWithCompletion:^(NSError * _Nullable error) {
                NotificationService *strongSelf = weakSelf;
                if (strongSelf == nil) { return; }
                if (error != nil) {
                    NSLog(@"[SYLK_APP] [nse] comm-notification donate failed: %s -- plain banner",
                          [[error localizedDescription] UTF8String]);
                    strongSelf.contentHandler(strongSelf.bestAttemptContent);
                    return;
                }
                NSError *updErr = nil;
                UNNotificationContent *updated =
                    [strongSelf.bestAttemptContent contentByUpdatingWithProvider:intent
                                                                           error:&updErr];
                if (updated != nil && updErr == nil) {
                    NSLog(@"[SYLK_APP] [nse] comm-notification for '%s'",
                          [fromUri UTF8String]);
                    strongSelf.contentHandler(updated);
                } else {
                    NSLog(@"[SYLK_APP] [nse] comm-notification update failed: %s -- plain banner",
                          [[updErr localizedDescription] UTF8String]);
                    strongSelf.contentHandler(strongSelf.bestAttemptContent);
                }
            }];
            return;
        } @catch (NSException *e) {
            NSLog(@"[SYLK_APP] [nse] comm-notification exception %s -- plain banner",
                  [(e.reason ?: @"(nil)") UTF8String]);
        }
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
