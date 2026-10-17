#import <AppKit/AppKit.h>
#import <signal.h>
#import <unistd.h>

static NSString *ProjectRoot(void) {
    NSURL *url=NSBundle.mainBundle.bundleURL.URLByDeletingLastPathComponent;
    for(int i=0;i<7;i++,url=url.URLByDeletingLastPathComponent)
        if([NSFileManager.defaultManager fileExistsAtPath:[url URLByAppendingPathComponent:@"scripts/gui-controller.mjs"].path])return url.path.stringByResolvingSymlinksInPath;
    return nil;
}
static NSString *NodeExecutable(void) {
    NSDictionary *env=NSProcessInfo.processInfo.environment;NSString *home=NSHomeDirectory();NSMutableArray *paths=[NSMutableArray array];
    for(NSString *dir in [env[@"PATH"]?:@"" componentsSeparatedByString:@":"])if(dir.length)[paths addObject:[dir stringByAppendingPathComponent:@"node"]];
    [paths addObjectsFromArray:@[@"/opt/homebrew/bin/node",@"/usr/local/bin/node",[home stringByAppendingPathComponent:@".volta/bin/node"]]];
    NSString *nvm=[env[@"NVM_DIR"]?:[home stringByAppendingPathComponent:@".nvm"] stringByAppendingPathComponent:@"versions/node"];
    NSArray *versions=[[NSFileManager.defaultManager contentsOfDirectoryAtPath:nvm error:NULL] sortedArrayUsingComparator:^NSComparisonResult(NSString *a,NSString *b){return [b compare:a options:NSNumericSearch];}];
    for(NSString *v in versions)[paths addObject:[[nvm stringByAppendingPathComponent:v] stringByAppendingPathComponent:@"bin/node"]];
    for(NSString *path in paths)if([NSFileManager.defaultManager isExecutableFileAtPath:path]){
        NSTask *task=[NSTask new];NSPipe *pipe=[NSPipe pipe];task.executableURL=[NSURL fileURLWithPath:path];task.arguments=@[@"--version"];task.standardOutput=pipe;task.standardError=[NSPipe pipe];
        if(![task launchAndReturnError:NULL])continue;NSDate *end=[NSDate dateWithTimeIntervalSinceNow:2.5];while(task.running&&end.timeIntervalSinceNow>0)usleep(10000);
        if(task.running){kill(task.processIdentifier,SIGKILL);[task waitUntilExit];continue;}
        NSString *value=[[NSString alloc]initWithData:pipe.fileHandleForReading.readDataToEndOfFile encoding:NSUTF8StringEncoding];value=[value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        NSArray *parts=[[value hasPrefix:@"v"]?[value substringFromIndex:1]:value componentsSeparatedByString:@"."];
        if(task.terminationStatus==0&&parts.count>=2&&([parts[0] intValue]>22||[parts[0] intValue]==22&&[parts[1] intValue]>=18))return path;
    }return nil;
}

static NSDictionary *StartRequest(NSString *port,BOOL lan){return @{@"action":@"start",@"port":port,@"lan":lan?@YES:@NO};}

@interface Launcher : NSObject<NSApplicationDelegate,NSWindowDelegate>
@property NSWindow *window;@property NSString *root;@property NSTask *bridge;@property NSFileHandle *input;@property NSMutableData *buffer;
@property NSTextField *status,*address,*port;@property NSButton *lan,*start,*stop,*browse;@property NSTextView *log;
@property BOOL quitting,allowQuit;
@end
@implementation Launcher
- (void)applicationDidFinishLaunching:(NSNotification*)note {
    NSImage *icon=[[NSImage alloc]initWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"MyTV" ofType:@"icns"]];if(icon)NSApp.applicationIconImage=icon;
    NSMenu *menu=[NSMenu new];NSMenuItem *item=[NSMenuItem new];NSMenu *appMenu=[NSMenu new];[appMenu addItemWithTitle:@"退出 My TV" action:@selector(terminate:) keyEquivalent:@"q"];item.submenu=appMenu;[menu addItem:item];NSApp.mainMenu=menu;
    self.root=ProjectRoot();
    NSData *bookmark=[NSUserDefaults.standardUserDefaults dataForKey:@"projectAccess"];
    BOOL stale=NO;NSURL *saved=bookmark?[NSURL URLByResolvingBookmarkData:bookmark options:NSURLBookmarkResolutionWithSecurityScope relativeToURL:nil bookmarkDataIsStale:&stale error:NULL]:nil;
    if(saved&&!stale&&(!self.root||[saved.path.stringByResolvingSymlinksInPath isEqual:self.root])){[saved startAccessingSecurityScopedResource];self.root=saved.path.stringByResolvingSymlinksInPath;}
    else {NSOpenPanel *picker=[NSOpenPanel openPanel];picker.title=@"选择 My TV 项目文件夹";picker.message=@"首次使用请选择项目文件夹，允许读取项目与保存观看历史。";picker.canChooseDirectories=YES;picker.canChooseFiles=NO;if(self.root)picker.directoryURL=[NSURL fileURLWithPath:self.root];
        if([picker runModal]!=NSModalResponseOK){self.allowQuit=YES;[NSApp terminate:nil];return;}self.root=picker.URL.path.stringByResolvingSymlinksInPath;
        NSData *grant=[picker.URL bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope includingResourceValuesForKeys:nil relativeToURL:nil error:NULL];if(grant)[NSUserDefaults.standardUserDefaults setObject:grant forKey:@"projectAccess"];[picker.URL startAccessingSecurityScopedResource];}

    self.buffer=[NSMutableData data];self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,650,530) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"My TV";self.window.delegate=self;self.window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];[self.window center];
    NSTextField *title=[NSTextField labelWithString:@"▶  My TV"];title.font=[NSFont systemFontOfSize:29 weight:NSFontWeightBold];title.textColor=[NSColor colorWithCalibratedRed:.79 green:.96 blue:.55 alpha:1];
    NSTextField *subtitle=[NSTextField labelWithString:@"启动服务，在浏览器中开始观影。"];subtitle.textColor=NSColor.secondaryLabelColor;
    self.status=[NSTextField labelWithString:@"正在连接控制器…"];self.status.font=[NSFont systemFontOfSize:16 weight:NSFontWeightMedium];self.address=[NSTextField labelWithString:@""];
    self.port=[NSTextField textFieldWithString:@"3210"];self.port.alignment=NSTextAlignmentCenter;[self.port.widthAnchor constraintEqualToConstant:84].active=YES;
    self.lan=[NSButton checkboxWithTitle:@"允许局域网访问" target:nil action:nil];NSStackView *settings=[NSStackView stackViewWithViews:@[[NSTextField labelWithString:@"端口"],self.port,self.lan]];settings.spacing=14;
    self.start=[NSButton buttonWithTitle:@"启动服务" target:self action:@selector(startService:)];self.stop=[NSButton buttonWithTitle:@"停止服务" target:self action:@selector(stopService:)];self.browse=[NSButton buttonWithTitle:@"打开观影网页" target:self action:@selector(openBrowser:)];
    for(NSButton *button in @[self.start,self.stop,self.browse]){button.bezelStyle=NSBezelStyleRounded;[button.heightAnchor constraintEqualToConstant:34].active=YES;}self.start.keyEquivalent=@"\r";self.start.enabled=NO;self.stop.enabled=NO;self.browse.enabled=NO;
    NSStackView *buttons=[NSStackView stackViewWithViews:@[self.start,self.stop,self.browse]];buttons.spacing=12;buttons.distribution=NSStackViewDistributionFillEqually;
    NSScrollView *scroll=[NSScrollView new];scroll.hasVerticalScroller=YES;scroll.borderType=NSBezelBorder;self.log=[NSTextView new];self.log.editable=NO;self.log.selectable=YES;self.log.font=[NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];self.log.textContainerInset=NSMakeSize(8,8);self.log.autoresizingMask=NSViewWidthSizable;self.log.verticallyResizable=YES;self.log.horizontallyResizable=NO;self.log.textContainer.widthTracksTextView=YES;scroll.documentView=self.log;
    NSTextField *footer=[NSTextField labelWithString:@"关闭此窗口会停止服务并释放端口，观看记录会保留。"];footer.font=[NSFont systemFontOfSize:11];footer.textColor=NSColor.secondaryLabelColor;
    NSTextField *path=[NSTextField labelWithString:self.root];path.font=[NSFont systemFontOfSize:10];path.textColor=NSColor.tertiaryLabelColor;path.lineBreakMode=NSLineBreakByTruncatingMiddle;
    NSStackView *stack=[NSStackView stackViewWithViews:@[title,subtitle,self.status,self.address,settings,buttons,[NSTextField labelWithString:@"运行详情"],scroll,footer,path]];stack.orientation=NSUserInterfaceLayoutOrientationVertical;stack.alignment=NSLayoutAttributeLeading;stack.spacing=13;stack.translatesAutoresizingMaskIntoConstraints=NO;[self.window.contentView addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[[stack.leadingAnchor constraintEqualToAnchor:self.window.contentView.leadingAnchor constant:24],[stack.trailingAnchor constraintEqualToAnchor:self.window.contentView.trailingAnchor constant:-24],[stack.topAnchor constraintEqualToAnchor:self.window.contentView.topAnchor constant:22],[stack.bottomAnchor constraintEqualToAnchor:self.window.contentView.bottomAnchor constant:-18],[scroll.widthAnchor constraintEqualToAnchor:stack.widthAnchor],[scroll.heightAnchor constraintGreaterThanOrEqualToConstant:170],[buttons.widthAnchor constraintEqualToAnchor:stack.widthAnchor],[self.address.widthAnchor constraintEqualToAnchor:stack.widthAnchor],[path.widthAnchor constraintEqualToAnchor:stack.widthAnchor]]];
    [self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];[self launchBridge];
}
- (void)append:(NSString*)text {self.log.string=[self.log.string stringByAppendingFormat:@"%@\n",text];if(self.log.string.length>40000)self.log.string=[self.log.string substringFromIndex:self.log.string.length-30000];[self.log scrollToEndOfDocument:nil];}
- (void)launchBridge {
    __weak Launcher *weak=self;dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{NSString *node=NodeExecutable();dispatch_async(dispatch_get_main_queue(),^{Launcher *self=weak;if(!self)return;
        if(!node){self.status.stringValue=@"未找到兼容的 Node.js";self.start.enabled=NO;[self append:@"请手动安装 Node.js 22.18 或更高版本（含 npm / 内置 SQLite），再重新打开启动器。\nhttps://nodejs.org/"];return;}
        NSTask *task=[NSTask new];NSPipe *input=[NSPipe pipe],*output=[NSPipe pipe],*error=[NSPipe pipe];task.executableURL=[NSURL fileURLWithPath:node];task.arguments=@[[self.root stringByAppendingPathComponent:@"scripts/gui-controller.mjs"],@"--root",self.root];task.currentDirectoryURL=[NSURL fileURLWithPath:@"/"];
        NSMutableDictionary *env=[NSProcessInfo.processInfo.environment mutableCopy];env[@"PATH"]=[NSString stringWithFormat:@"%@:/opt/homebrew/bin:/usr/local/bin:%@",node.stringByDeletingLastPathComponent,env[@"PATH"]?:@"/usr/bin:/bin:/usr/sbin:/sbin"];task.environment=env;task.standardInput=input;task.standardOutput=output;task.standardError=error;
        output.fileHandleForReading.readabilityHandler=^(NSFileHandle *h){NSData *data=h.availableData;if(!data.length){h.readabilityHandler=nil;return;}dispatch_async(dispatch_get_main_queue(),^{[weak consume:data];});};
        error.fileHandleForReading.readabilityHandler=^(NSFileHandle *h){NSData *data=h.availableData;if(!data.length){h.readabilityHandler=nil;return;}NSString *text=[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding];if(text)dispatch_async(dispatch_get_main_queue(),^{[weak append:text];});};
        task.terminationHandler=^(NSTask *p){dispatch_async(dispatch_get_main_queue(),^{Launcher *self=weak;if(self&&!self.allowQuit){self.status.stringValue=@"控制器已结束，请重新打开启动器";self.start.enabled=NO;}});};
        NSError *problem=nil;if([task launchAndReturnError:&problem]){self.bridge=task;self.input=input.fileHandleForWriting;}else{self.status.stringValue=@"无法启动控制器";[self append:problem.localizedDescription];}
    });});
}
- (void)consume:(NSData*)data {
    [self.buffer appendData:data];NSData *newline=[@"\n" dataUsingEncoding:NSUTF8StringEncoding];NSRange range;
    while((range=[self.buffer rangeOfData:newline options:0 range:NSMakeRange(0,self.buffer.length)]).location!=NSNotFound){NSData *line=[self.buffer subdataWithRange:NSMakeRange(0,range.location)];[self.buffer replaceBytesInRange:NSMakeRange(0,range.location+1) withBytes:NULL length:0];NSDictionary *v=[NSJSONSerialization JSONObjectWithData:line options:0 error:NULL];if(![v isKindOfClass:NSDictionary.class])continue;
        NSString *type=v[@"type"];
        if([type isEqual:@"state"]){NSString *phase=v[@"phase"];BOOL busy=[@[@"preparing",@"starting",@"stopping"] containsObject:phase],running=[phase isEqual:@"running"];
            self.status.stringValue=v[@"message"]?:@"";self.status.textColor=running?NSColor.systemGreenColor:NSColor.labelColor;self.port.stringValue=[v[@"port"] stringValue]?:@"3210";self.lan.state=[v[@"lan"] boolValue]?NSControlStateValueOn:NSControlStateValueOff;
            self.start.enabled=!busy&&!running&&!self.quitting;self.stop.enabled=(running||[phase isEqual:@"preparing"]||[phase isEqual:@"starting"])&&!self.quitting;self.browse.enabled=running&&!self.quitting;self.port.enabled=!busy&&!running&&!self.quitting;self.lan.enabled=self.port.enabled;
            self.address.stringValue=running?[[(@[v[@"url"]?:@""]) arrayByAddingObjectsFromArray:v[@"addresses"]?:@[]] componentsJoinedByString:@"   "]:@"";
        }else if([type isEqual:@"log"])[self append:v[@"message"]?:@""];
        else if([type isEqual:@"closed"]){self.allowQuit=YES;[NSApp terminate:nil];}
        else if([type isEqual:@"error"]){[self append:v[@"message"]?:@"操作失败"];if(self.quitting){self.quitting=NO;self.status.stringValue=@"停止未完成，请查看运行详情";self.stop.enabled=YES;}}
    }
}
- (void)send:(NSDictionary*)value {if(!self.input)return;NSMutableData *data=[[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL] mutableCopy];[data appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];@try{[self.input writeData:data];}@catch(NSException *e){[self append:e.reason];}}
- (void)startService:(id)sender {self.start.enabled=NO;[self send:StartRequest(self.port.stringValue,self.lan.state==NSControlStateValueOn)];}
- (void)stopService:(id)sender {self.stop.enabled=NO;[self send:@{@"action":@"stop"}];}
- (void)openBrowser:(id)sender {NSURL *url=[NSURL URLWithString:[@"http://127.0.0.1:" stringByAppendingString:self.port.stringValue]];if(url)[NSWorkspace.sharedWorkspace openURL:url];}
- (void)beginQuit {if(self.quitting)return;if(!self.bridge.running){self.allowQuit=YES;[NSApp terminate:nil];return;}self.quitting=YES;self.status.stringValue=@"正在停止并释放端口…";self.start.enabled=NO;self.stop.enabled=NO;self.browse.enabled=NO;[self send:@{@"action":@"quit"}];}
- (BOOL)windowShouldClose:(NSWindow*)sender {[self beginQuit];return NO;}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)sender {if(self.allowQuit)return NSTerminateNow;[self beginQuit];return NSTerminateCancel;}
@end

int main(int argc,const char *argv[]){@autoreleasepool{
    NSArray *args=NSProcessInfo.processInfo.arguments;NSUInteger at=[args indexOfObject:@"--self-test"];
    if(at!=NSNotFound){NSString *root=ProjectRoot(),*node=NodeExecutable();NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"platform":@"macOS",@"icon":([[NSImage alloc]initWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"MyTV" ofType:@"icns"]]?@YES:@NO),@"root":root?:@"",@"node":node?:@"",@"start":StartRequest(@"3210",NO)} options:0 error:NULL];if(args.count>at+1)[data writeToFile:args[at+1] atomically:YES];printf("%s\n",[[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding] UTF8String]);return root&&node?0:1;}
    NSApplication *app=NSApplication.sharedApplication;__attribute__((objc_precise_lifetime)) Launcher *delegate=[Launcher new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];
}return 0;}
