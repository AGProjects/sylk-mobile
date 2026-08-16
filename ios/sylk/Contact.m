#import "Contact.h"

@implementation Contact

- (instancetype)initWithDisplayName:(NSString *)displayName
                                tags:(NSArray<NSString *> *)tags {
    return [self initWithDisplayName:displayName tags:tags autoAnswer:nil];
}

- (instancetype)initWithDisplayName:(NSString *)displayName
                                tags:(NSArray<NSString *> *)tags
                          autoAnswer:(NSNumber *)autoAnswer {
    self = [super init];
    if (self) {
        _displayName = displayName;
        _tags = tags ?: @[];   // NEVER nil
        _autoAnswer = autoAnswer;   // nil = unknown, see the header
    }
    return self;
}

- (BOOL)hasTags {
    return self.tags.count > 0;
}

@end
