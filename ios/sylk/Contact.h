#import <Foundation/Foundation.h>

@interface Contact : NSObject

@property (nonatomic, strong, nullable) NSString *displayName;
@property (nonatomic, strong) NSArray<NSString *> *tags;

- (instancetype)initWithDisplayName:(nullable NSString *)displayName
                                tags:(NSArray<NSString *> *)tags;

- (BOOL)hasTags;

@end
