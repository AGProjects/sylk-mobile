#import <Foundation/Foundation.h>

@interface Contact : NSObject

@property (nonatomic, strong, nullable) NSString *displayName;
@property (nonatomic, strong) NSArray<NSString *> * _Nonnull tags;

/// Per-device auto-answer flag, read from the contact row's `local_properties`
/// JSON (`{"autoanswer":true,...}`).
///
/// NIL means the column had nothing to say about it (legacy row, absent key,
/// unparseable JSON) — NOT "false". Callers must fall back to the `autoanswer`
/// TAG in that case and only in that case; see -shouldAutoAnswerForContact:.
///
/// Why this exists at all: the tag is synced through the server address book,
/// so it describes the ACCOUNT. Auto-answer is per DEVICE — enabling it on one
/// device sends a message telling the others to switch off. Reading the tag
/// made a device auto-answer calls its own UI correctly showed as not
/// auto-answering (Android, 2026-08-16; iOS had the identical bug).
@property (nonatomic, strong, nullable) NSNumber *autoAnswer;

- (nonnull instancetype)initWithDisplayName:(nullable NSString *)displayName
                                       tags:(nullable NSArray<NSString *> *)tags;

- (nonnull instancetype)initWithDisplayName:(nullable NSString *)displayName
                                       tags:(nullable NSArray<NSString *> *)tags
                                 autoAnswer:(nullable NSNumber *)autoAnswer;

- (BOOL)hasTags;

@end
