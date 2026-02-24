#import "Contact.h"

@implementation Contact

- (instancetype)initWithDisplayName:(NSString *)displayName
                                tags:(NSArray<NSString *> *)tags {
    self = [super init];
    if (self) {
        _displayName = displayName;
        _tags = tags ?: @[];   // NEVER nil
    }
    return self;
}

- (BOOL)hasTags {
    return self.tags.count > 0;
}

@end
