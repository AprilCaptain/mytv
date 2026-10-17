#import <AppKit/AppKit.h>

static NSColor *Color(unsigned value){return [NSColor colorWithCalibratedRed:((value>>16)&255)/255.0 green:((value>>8)&255)/255.0 blue:(value&255)/255.0 alpha:1];}
// Same vector geometry and colors as icon.svg, rendered with the system graphics engine.
static NSData *Render(int size){
    NSBitmapImageRep *bitmap=[[NSBitmapImageRep alloc]initWithBitmapDataPlanes:NULL pixelsWide:size pixelsHigh:size bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    [NSGraphicsContext saveGraphicsState];NSGraphicsContext.currentContext=[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    NSGraphicsContext.currentContext.shouldAntialias=YES;
    NSAffineTransform *scale=[NSAffineTransform transform];[scale scaleBy:size/1024.0];[scale concat];
    NSBezierPath *bezel=[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(64,64,896,896) xRadius:224 yRadius:224];
    [[[NSGradient alloc]initWithStartingColor:Color(0x35412c) endingColor:Color(0x141b11)] drawInBezierPath:bezel angle:-90];
    NSBezierPath *screen=[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(148,148,728,728) xRadius:172 yRadius:172];
    [[[NSGradient alloc]initWithStartingColor:Color(0xd5f99d) endingColor:Color(0xb7e67c)] drawInBezierPath:screen angle:-90];
    [[NSColor colorWithWhite:1 alpha:.2]setStroke];NSBezierPath *rim=[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(150,150,724,724) xRadius:170 yRadius:170];rim.lineWidth=4;[rim stroke];
    NSBezierPath *play=[NSBezierPath bezierPath];[play moveToPoint:NSMakePoint(421,698)];
    [play curveToPoint:NSMakePoint(402,687) controlPoint1:NSMakePoint(408.33,705.33) controlPoint2:NSMakePoint(402,701.67)];
    [play lineToPoint:NSMakePoint(402,337)];[play curveToPoint:NSMakePoint(421,326) controlPoint1:NSMakePoint(402,322.33) controlPoint2:NSMakePoint(408.33,318.67)];
    [play lineToPoint:NSMakePoint(701,495)];[play curveToPoint:NSMakePoint(701,529) controlPoint1:NSMakePoint(719.67,506.33) controlPoint2:NSMakePoint(719.67,517.67)];[play closePath];[Color(0x1c2915)setFill];[play fill];
    [NSGraphicsContext restoreGraphicsState];return [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}
int main(int argc,const char *argv[]){@autoreleasepool{
    if(argc!=2)return 1;NSString *out=[NSString stringWithUTF8String:argv[1]];
    for(NSNumber *n in @[@16,@20,@24,@32,@40,@48,@64,@128,@256,@512,@1024])
        if(![Render(n.intValue)writeToFile:[out stringByAppendingPathComponent:[NSString stringWithFormat:@"icon-%@.png",n]] atomically:YES])return 1;
}return 0;}
