// Test-only AppKit input. Electron's sendInputEvent skips the NSApplication
// event queue entirely, so it cannot reproduce macOS Command-key behavior.
#import <AppKit/AppKit.h>
#include <node_api.h>

static napi_value post(napi_env env, napi_callback_info info) {
  napi_value args[4]; size_t n = 4; int32_t type, mods, code; bool repeat;
  napi_get_cb_info(env, info, &n, args, NULL, NULL);
  napi_get_value_int32(env, args[0], &type); napi_get_value_int32(env, args[1], &mods);
  napi_get_value_int32(env, args[2], &code); napi_get_value_bool(env, args[3], &repeat);
  NSEventType eventType = type == 0 ? NSEventTypeKeyDown : type == 1 ? NSEventTypeKeyUp : NSEventTypeFlagsChanged;
  NSString *key = type == 2 ? @"" : @"q";
  [NSApp postEvent:[NSEvent keyEventWithType:eventType location:NSZeroPoint modifierFlags:mods
    timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:NSApp.keyWindow.windowNumber context:nil
    characters:key charactersIgnoringModifiers:key isARepeat:repeat keyCode:code] atStart:NO];
  return NULL;
}

static napi_value snapshot(napi_env env, napi_callback_info info) {
  for (NSWindow *window in NSApp.windows) {
    if (![window.identifier isEqual:@"VelaHoldToQuit"] || !window.visible) continue;
    NSView *view = window.contentView;
    napi_value result, text; napi_create_object(env, &result);
    for (NSView *item in view.subviews) if ([item isKindOfClass:NSTextField.class]) {
      napi_create_string_utf8(env, ((NSTextField *)item).stringValue.UTF8String, NAPI_AUTO_LENGTH, &text);
      napi_set_named_property(env, result, item.frame.origin.y > 40 ? "title" : "detail", text);
    }
    napi_value arg; size_t n = 1; char path[4096];
    napi_get_cb_info(env, info, &n, &arg, NULL, NULL);
    if (n == 1) {
      // A view snapshot alone cannot detect an unmasked behind-window blur.
      NSImage *mask = [view isKindOfClass:NSVisualEffectView.class] ? ((NSVisualEffectView *)view).maskImage : nil;
      NSBitmapImageRep *pixels = mask ? [NSBitmapImageRep imageRepWithData:mask.TIFFRepresentation] : nil;
      NSInteger x = pixels.pixelsWide - 1, y = pixels.pixelsHigh - 1;
      BOOL rounded = pixels && [pixels colorAtX:x/2 y:y/2].alphaComponent > 0.99 &&
        [pixels colorAtX:0 y:0].alphaComponent == 0 && [pixels colorAtX:x y:0].alphaComponent == 0 &&
        [pixels colorAtX:0 y:y].alphaComponent == 0 && [pixels colorAtX:x y:y].alphaComponent == 0;
      napi_value checked; napi_get_boolean(env, rounded, &checked);
      napi_set_named_property(env, result, "roundedMaterial", checked);
      if (napi_get_value_string_utf8(env, arg, path, sizeof(path), NULL) == napi_ok) {
        NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
        [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:@(path) atomically:YES];
      }
    }
    return result;
  }
  return NULL;
}
NAPI_MODULE_INIT() {
  napi_property_descriptor methods[] = {{"post", NULL, post}, {"snapshot", NULL, snapshot}};
  napi_define_properties(env, exports, 2, methods); return exports;
}
