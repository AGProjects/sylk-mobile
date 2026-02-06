// ActiveChatManager.h
#import <Foundation/Foundation.h>

@interface ActiveChatManager : NSObject


+ (instancetype)shared;
@property (nonatomic, strong, nullable) NSString *activeChatJID; // can be nil

@end
