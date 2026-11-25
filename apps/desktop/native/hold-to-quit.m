// App-local only. AppKit can discard Q's keyUp while Command is held before it
// reaches Chromium. A local NSEvent monitor sees it without Input Monitoring
// permission, including when a webview, a native control, or no window has focus.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>

static const NSTimeInterval holdSeconds = 1.5;
static napi_env js;
static napi_ref readHint, quitApp;
static id monitor;
static NSMutableArray *observers;
static NSPanel *hud;
static NSView *fill;
static NSTimer *hold, *linger;
static unsigned short pressedCode;

static napi_value call(napi_ref ref) {
  napi_value callback, receiver, result;
  napi_get_reference_value(js, ref, &callback);
  napi_get_undefined(js, &receiver);
  return napi_call_function(js, receiver, callback, 0, NULL, &result) == napi_ok ? result : NULL;
}

static NSString *stringAt(napi_value array, uint32_t index) {
  napi_value item;
  size_t length;
  if (napi_get_element(js, array, index, &item) != napi_ok ||
      napi_get_value_string_utf8(js, item, NULL, 0, &length) != napi_ok) return nil;
  NSMutableData *bytes = [NSMutableData dataWithLength:length + 1];
  napi_get_value_string_utf8(js, item, bytes.mutableBytes, bytes.length, NULL);
  return [[NSString alloc] initWithBytes:bytes.bytes length:length encoding:NSUTF8StringEncoding];
}

static void hide(void) {
  [linger invalidate]; linger = nil;
  [hud orderOut:nil]; hud = nil; fill = nil;
}

static void cancel(BOOL keepHint) {
  [hold invalidate]; hold = nil;
  if (keepHint && hud) {
    // Even a quick tap leaves time to read the warning; it never keeps ticking.
    [fill setFrameSize:NSMakeSize(0, fill.frame.size.height)];
    [linger invalidate];
    linger = [NSTimer scheduledTimerWithTimeInterval:1.8 repeats:NO block:^(NSTimer *timer) { hide(); }];
  } else hide();
}

static NSTextField *label(NSString *text, CGFloat size, NSFontWeight weight, NSColor *color) {
  NSTextField *field = [NSTextField labelWithString:text];
  field.font = [NSFont systemFontOfSize:size weight:weight];
  field.textColor = color;
  [field sizeToFit];
  return field;
}

static void showHint(NSString *title, NSString *detail, BOOL busy) {
  NSTextField *heading = label(title, 16, NSFontWeightSemibold, NSColor.labelColor);
  NSTextField *body = label(detail, 13, NSFontWeightRegular, NSColor.secondaryLabelColor);
  NSColor *accent = busy ? NSColor.systemOrangeColor : NSColor.controlAccentColor;
  CGFloat width = ceil(MAX(heading.frame.size.width, body.frame.size.width)) + 108;
  NSRect frame = NSMakeRect(0, 0, width, 91);
  hud = [[NSPanel alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  hud.identifier = @"VelaHoldToQuit";
  hud.opaque = NO; hud.backgroundColor = NSColor.clearColor; hud.hasShadow = YES;
  hud.level = NSStatusWindowLevel; hud.ignoresMouseEvents = YES;
  hud.collectionBehavior = NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorMoveToActiveSpace;
  NSVisualEffectView *card = [[NSVisualEffectView alloc] initWithFrame:frame];
  card.material = NSVisualEffectMaterialPopover; card.state = NSVisualEffectStateActive;
  // Layer clipping alone leaves the separately composited behind-window blur square.
  // AppKit uses the content view's material mask for the window shadow as well.
  const CGFloat radius = 14, side = 2 * radius + 1;
  NSImage *mask = [NSImage imageWithSize:NSMakeSize(side, side) flipped:NO drawingHandler:^BOOL(NSRect bounds) {
    [NSColor.blackColor setFill];
    [[NSBezierPath bezierPathWithRoundedRect:bounds xRadius:radius yRadius:radius] fill];
    return YES;
  }];
  mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
  mask.resizingMode = NSImageResizingModeStretch;
  card.maskImage = mask;
  card.wantsLayer = YES; card.layer.cornerRadius = radius; card.layer.masksToBounds = YES;
  hud.contentView = card;
  // Resolve dynamic colors in the HUD's current appearance, also in dark mode.
  [hud.effectiveAppearance performAsCurrentDrawingAppearance:^{
    card.layer.borderWidth = 1 / (NSScreen.mainScreen.backingScaleFactor ?: 1);
    card.layer.borderColor = NSColor.separatorColor.CGColor;
    NSView *keycap = [[NSView alloc] initWithFrame:NSMakeRect(18, 31, 49, 39)];
    keycap.wantsLayer = YES; keycap.layer.cornerRadius = 8;
    keycap.layer.backgroundColor = [accent colorWithAlphaComponent:0.09].CGColor;
    keycap.layer.borderWidth = 1; keycap.layer.borderColor = [accent colorWithAlphaComponent:0.25].CGColor;
    NSTextField *keys = label(@"⌘ Q", 16, NSFontWeightMedium, NSColor.labelColor);
    [keys setFrameOrigin:NSMakePoint(round((49 - keys.frame.size.width) / 2), round((39 - keys.frame.size.height) / 2))];
    [keycap addSubview:keys]; [card addSubview:keycap];
    NSView *track = [[NSView alloc] initWithFrame:NSMakeRect(18, 15, width - 36, 3)];
    track.wantsLayer = YES; track.layer.backgroundColor = NSColor.separatorColor.CGColor;
    track.layer.cornerRadius = 1.5; track.layer.masksToBounds = YES;
    fill = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 0, 3)];
    fill.wantsLayer = YES; fill.layer.backgroundColor = accent.CGColor;
    [track addSubview:fill]; [card addSubview:track];
  }];
  [heading setFrameOrigin:NSMakePoint(80, 51)]; [card addSubview:heading];
  [body setFrameOrigin:NSMakePoint(80, 31)]; [card addSubview:body];
  NSWindow *owner = NSApp.keyWindow;
  NSRect screen = (owner.screen ?: NSScreen.mainScreen).visibleFrame;
  NSRect anchor = owner ? NSIntersectionRect(screen, owner.frame) : screen;
  [hud setFrameOrigin:NSMakePoint(round(MAX(NSMinX(screen), MIN(NSMidX(anchor) - width / 2, NSMaxX(screen) - width))),
                                  round(MAX(NSMinY(screen), NSMaxY(anchor) - 155)))];
  [hud orderFrontRegardless];
  NSAccessibilityPostNotificationWithUserInfo(hud, NSAccessibilityAnnouncementRequestedNotification, @{
    NSAccessibilityAnnouncementKey: [NSString stringWithFormat:@"%@. %@", title, detail],
    NSAccessibilityPriorityKey: @(busy ? NSAccessibilityPriorityHigh : NSAccessibilityPriorityMedium) });
}

static void begin(unsigned short code) {
  cancel(NO);
  napi_handle_scope scope;
  napi_open_handle_scope(js, &scope);
  napi_value hint = call(readHint), flag;
  bool busy = false;
  NSString *title = hint ? stringAt(hint, 0) : nil, *detail = hint ? stringAt(hint, 1) : nil;
  if (hint && napi_get_element(js, hint, 2, &flag) == napi_ok) napi_get_value_bool(js, flag, &busy);
  napi_close_handle_scope(js, scope);
  if (!title || !detail) return; // Never arm an invisible quit.
  NSWindow *owner = NSApp.keyWindow;
  showHint(title, detail, busy);
  pressedCode = code;
  NSTimeInterval start = NSProcessInfo.processInfo.systemUptime;
  hold = [NSTimer scheduledTimerWithTimeInterval:1.0 / 30 repeats:YES block:^(NSTimer *timer) {
    if (!NSApp.active || owner != NSApp.keyWindow || (owner && (!owner.visible || owner.miniaturized))) { cancel(NO); return; }
    double fraction = (NSProcessInfo.processInfo.systemUptime - start) / holdSeconds;
    [fill setFrameSize:NSMakeSize(fill.superview.bounds.size.width * MIN(1, fraction), 3)];
    if (fraction < 1) return;
    cancel(NO);
    napi_handle_scope scope;
    napi_open_handle_scope(js, &scope); call(quitApp); napi_close_handle_scope(js, scope);
  }];
}

static napi_value uninstall(napi_env env, napi_callback_info info) {
  cancel(NO);
  if (monitor) { [NSEvent removeMonitor:monitor]; monitor = nil; }
  for (id token in observers) {
    [NSNotificationCenter.defaultCenter removeObserver:token];
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:token];
  }
  observers = nil;
  if (readHint) { napi_delete_reference(env, readHint); readHint = NULL; }
  if (quitApp) { napi_delete_reference(env, quitApp); quitApp = NULL; }
  return NULL;
}

static napi_value install(napi_env env, napi_callback_info info) {
  napi_value args[2], dispose; size_t count = 2;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 2 || monitor) { napi_throw_error(env, NULL, "Invalid hold-to-quit installation"); return NULL; }
  js = env;
  napi_create_reference(env, args[0], 1, &readHint); napi_create_reference(env, args[1], 1, &quitApp);
  NSEventMask mask = NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged | NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) {
    NSEventModifierFlags mods = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift);
    if (event.type == NSEventTypeKeyDown && NSApp.active && mods == NSEventModifierFlagCommand && [event.charactersIgnoringModifiers.lowercaseString isEqual:@"q"]) {
      if (!event.isARepeat) begin(event.keyCode);
      return nil;
    }
    if (hold && event.type == NSEventTypeKeyUp && event.keyCode == pressedCode) { cancel(YES); return nil; }
    if (hold && event.type == NSEventTypeFlagsChanged && mods != NSEventModifierFlagCommand) cancel(YES);
    else if (event.type == NSEventTypeKeyDown || event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown) cancel(NO);
    return event;
  }];
  observers = [NSMutableArray array];
  for (NSString *name in @[NSApplicationWillResignActiveNotification, NSApplicationWillHideNotification, NSWindowDidResignKeyNotification,
                            NSWindowWillMiniaturizeNotification, NSWorkspaceWillSleepNotification]) {
    NSNotificationCenter *center = [name isEqual:NSWorkspaceWillSleepNotification] ? NSWorkspace.sharedWorkspace.notificationCenter : NSNotificationCenter.defaultCenter;
    id token = [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *n) { cancel(NO); }];
    [observers addObject:token];
  }
  napi_create_function(env, NULL, 0, uninstall, NULL, &dispose);
  return dispose;
}

NAPI_MODULE_INIT() {
  napi_value fn; napi_create_function(env, "install", NAPI_AUTO_LENGTH, install, NULL, &fn); return fn;
}
