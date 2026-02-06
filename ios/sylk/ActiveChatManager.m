// ActiveChatManager.m
#import "ActiveChatManager.h"

@implementation ActiveChatManager

+ (instancetype)shared {
    static ActiveChatManager *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[ActiveChatManager alloc] init];
    });
    return instance;
}

@end
