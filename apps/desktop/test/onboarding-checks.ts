import releaseNotesFile from "../release-notes.json";
/** Browser checks that drive the real OnboardingView end to end against the in-memory IPC of onboarding-preview. */
export async function runOnboardingChecks() {
  const output = document.createElement("pre");
  output.id = "onboarding-check-results";
  output.style.cssText = "position:fixed;inset:0;z-index:1000;background:white;color:#202124;padding:24px;overflow:auto";
  document.body.append(output);
  const fixture = (window as any).onboardingFixture;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const until = async (condition: () => boolean, message: string, timeout = 3000) => {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > timeout) throw new Error(`Timed out: ${message}`);
      await wait(15);
    }
  };
  const all = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document.querySelector(".ob-scr.on") ?? document) => [...root.querySelectorAll<T>(selector)];
  const node = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document.querySelector(".ob-scr.on") ?? document) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  };
  const byText = <T extends HTMLElement = HTMLElement>(selector: string, text: string, root: ParentNode = document.querySelector(".ob-scr.on") ?? document) => {
    const element = all<T>(selector, root).find((item) => item.textContent?.trim().includes(text));
    if (!element) throw new Error(`Missing ${selector} with text "${text}"`);
    return element;
  };
  const bar = () => node(".ob-bar", document);
  const primary = () => node<HTMLButtonElement>(".ob-pill.fill", bar());
  const back = () => node<HTMLButtonElement>(".ob-pill:not(.fill)", bar());
  const forward = () => node<HTMLButtonElement>(".ob-r .ob-pill:last-child", bar());
  const stage = () => document.querySelector<HTMLElement>(".ob-stage")!;
  /** 等舞台换到目标画面并稳定（离场画面被卸载）。 */
  const reach = async (screen: string) => {
    await until(() => stage().dataset.screen === screen, `screen ${screen}`);
    await until(() => !document.querySelector(".ob-scr.under"), `screen ${screen} exit`);
  };
  const press = async (button: HTMLElement) => { button.click(); await wait(20); };
  const next = async (screen: string) => { await press(primary()); await reach(screen); };
  const calls = (name: string) => fixture.state.calls.filter((call: any) => call.name === name);
  const type = (element: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  let passed = 0;
  const check = async (name: string, callback: () => Promise<void>) => { await callback(); ++passed; output.textContent += `PASS ${name}\n`; };

  try {
    await wait(300);
    await check("language comes first: five native names, no footer, root is forced light", async () => {
      await reach("language");
      const options = all<HTMLButtonElement>(".ob-language-opt");
      assert(options.length === 5, "five languages expected");
      assert(options.map((item) => item.textContent).join("|").includes("日本語") && options.some((item) => item.textContent!.includes("English")), "native language names missing");
      assert(options.some((item) => item.getAttribute("aria-checked") === "true"), "current language should be selected");
      assert(!document.querySelector(".ob-bar"), "language screen must not show the setup bar");
      const root = document.querySelector<HTMLElement>(".ob-root")!;
      assert(root.dataset.scheme === "light" && root.dataset.theme === "daylight", "onboarding must be pinned to the light scheme");
    });

    await check("picking a language switches the copy immediately and persists the locale", async () => {
      await press(byText(".ob-language-opt", "简体中文"));
      await until(() => document.querySelector(".ob-language-main h1")?.textContent === "先选一种语言", "chinese title");
      assert(localStorage.getItem("vela.locale") === "zh-CN", "locale not persisted");
      await press(byText(".ob-language-opt", "English"));
      await until(() => document.querySelector(".ob-language-main h1")?.textContent === "Pick a language first", "english title");
      await press(node(".ob-go"));
      await reach("hello");
    });

    await check("hello leads through the tour, three feature pages and the news card in order", async () => {
      assert(all(".ob-tabs button").length === 3, "hello should list meet / news / setup");
      await press(node(".ob-go")); await reach("tour");
      assert(all(".ob-tiles > *").length === 8, "tour should show eight cards");
      assert(forward().textContent!.includes("See what"), "tour should lead to the news");
      await press(all<HTMLButtonElement>(".ob-tiles button")[0]!); await reach("feat-agents");
      await press(forward()); await reach("feat-trace");
      await press(forward()); await reach("feat-compact");
      await press(forward()); await reach("news");
      assert(document.querySelector(".ob-scr.on")!.textContent!.includes(releaseNotesFile.version), "news should show the release version");
      assert(all(".ob-news-new .ob-strip").length === 4 && all(".ob-news-imp li").length === 4, "news should show four highlights and four improvements");
    });

    await check("news opens the release page and continues into setup", async () => {
      await press(byText(".ob-link", "release notes"));
      assert(calls("releaseNotes.openPage").length === 1, "release page not opened");
      await press(forward()); await reach("step-1");
    });

    await check("setup lists 8 steps with two optional markers and future steps stay locked", async () => {
      assert(all(".ob-route li", document).length === 8, "rail should list 8 steps");
      assert(all(".ob-route em", document).length === 2, "skills and personalize should be optional");
      assert(all<HTMLButtonElement>(".ob-route button", document).every((item) => item.disabled), "nothing before step 1 is reachable");
    });

    await check("appearance and tool display choices are applied immediately", async () => {
      await press(byText(".ob-opts .ob-opt", "Dark")); assert(byText(".ob-opts .ob-opt", "Dark").getAttribute("aria-checked") === "true", "dark appearance not selected");
      const dots = all<HTMLButtonElement>(".ob-dots button");
      assert(dots.length >= 6, "theme dots missing");
      await press(dots[1]!); assert(all<HTMLButtonElement>(".ob-dots button")[1]!.getAttribute("aria-checked") === "true", "theme not selected");
      const root = document.querySelector<HTMLElement>(".ob-root")!;
      assert(root.dataset.scheme === "light" && root.dataset.theme === "daylight", "choosing a dark app theme must not recolour onboarding");
      await press(byText(".ob-opts .ob-opt", "System"));
      await next("step-2");
      await press(all<HTMLButtonElement>(".ob-opt")[1]!);
      assert(all(".ob-opt")[1]!.getAttribute("aria-checked") === "true", "compact tool display not selected");
      assert(all(".ob-opt")[0]!.getAttribute("aria-checked") === "false", "card tool display still selected");
    });

    await check("info panel layout offers sidebar and floating and persists the Intelligent UI preference", async () => {
      await next("step-3");
      const cards = all<HTMLButtonElement>(".ob-opt.pick");
      assert(cards.length === 2 && cards.every((item) => item.querySelector(".ob-lay")), "layout cards with previews expected");
      assert(cards[0]!.getAttribute("aria-checked") === "true", "sidebar should be the default");
      await press(cards[1]!);
      assert(all(".ob-opt.pick")[1]!.getAttribute("aria-checked") === "true", "floating not selected");
      assert(all(".ob-opt.pick")[0]!.getAttribute("aria-checked") === "false", "sidebar still selected");
      await press(byText(".ob-seg button", "Visual first"));
      await until(() => calls("setIntelligentUi").length === 1, "Intelligent UI preference saved");
      assert(calls("setIntelligentUi")[0].arg === "visual_first", "wrong Intelligent UI preference");
      assert(byText(".ob-seg button", "Visual first").getAttribute("aria-checked") === "true", "UI preference not reflected");
    });

    await check("skills step can be skipped or continued without migrating", async () => {
      await next("step-4");
      await until(() => primary().textContent!.includes("Continue without migrating"), "skills step footer");
      assert(!!byText(".ob-link", "Skip this step", bar()), "skills step must be skippable");
      assert(calls("migrateSkills").length === 0, "nothing should be migrated");
      await next("step-5");
    });

    await check("provider step blocks until a connected provider is chosen", async () => {
      const cards = all<HTMLButtonElement>(".ob-prov [role=radio]");
      assert(cards.length === 2, "two providers expected");
      assert(cards[0]!.getAttribute("aria-checked") === "true", "connected provider should be preselected");
      await press(cards[1]!);
      assert(primary().disabled, "continue must be disabled for an unconnected provider");
      await press(all<HTMLButtonElement>(".ob-prov [role=radio]")[0]!);
      assert(!primary().disabled, "continue must be enabled for a connected provider");
      await next("step-6");
    });

    await check("model step saves provider, model and reasoning before personalization", async () => {
      await until(() => node<HTMLSelectElement>(".ob-field select").value === "demo-fast", "first model should be preselected");
      await press(byText(".ob-opts.sails .ob-opt", "High"));
      await next("step-7");
      const saved = calls("saveAgentSettings").at(-1)?.arg;
      assert(saved?.provider === "demo" && saved.modelId === "demo-fast" && saved.thinkingLevel === "high", `unexpected saved settings ${JSON.stringify(saved)}`);
    });

    await check("personalize toggles memory immediately and saves instructions on continue, keeping the model", async () => {
      await until(() => node("[role=switch]").getAttribute("aria-checked") === "true", "memory state loaded");
      await press(node("[role=switch]"));
      await until(() => calls("memory.setEnabled").length === 1, "memory toggle saved");
      assert(calls("memory.setEnabled")[0].arg === false, "memory should be switched off");
      assert(node("[role=switch]").getAttribute("aria-checked") === "false", "memory switch not reflected");
      type(node<HTMLTextAreaElement>("textarea.ob-lined"), "Answer in concise English.");
      await wait(20);
      await next("step-8");
      const saved = calls("saveAgentSettings").at(-1)?.arg;
      assert(saved?.instructions === "Answer in concise English." && saved.provider === "demo" && saved.modelId === "demo-fast", `instructions not saved with the model ${JSON.stringify(saved)}`);
    });

    await check("background step applies resident mode, notifications and auto update immediately", async () => {
      assert(primary().textContent!.includes("Finish setup"), "last configuration step should finish setup");
      await until(() => !!all(".ob-seg button").find((item) => item.textContent === "Proactive"), "resident settings loaded");
      await press(byText(".ob-seg button", "Proactive"));
      await until(() => calls("resident.updateSettings").some((call: any) => call.arg.mode === "proactive"), "mode saved");
      assert(fixture.state.resident.mode === "proactive", "resident mode not applied");
      const switches = () => all<HTMLElement>("[role=switch]");
      assert(switches().length === 4 && switches().every((item) => !item.hasAttribute("disabled")), "toggles should be usable while resident is on");
      await press(byText(".ob-seg button", "Disabled"));
      await until(() => fixture.state.resident.mode === "disabled", "disabled applied");
      await until(() => switches().slice(0, 3).every((item) => item.hasAttribute("disabled")), "resident toggles disabled");
      assert(!switches()[3]!.hasAttribute("disabled"), "auto update must stay usable");
      await press(byText(".ob-seg button", "Standby"));
      await until(() => fixture.state.resident.mode === "standby", "standby applied");
      await press(switches()[3]!);
      await until(() => calls("updates.setAutoUpdate").length === 1, "auto update saved");
      assert(calls("updates.setAutoUpdate")[0].arg === false && fixture.state.update.autoUpdate === false, "auto update should be off");
      assert(!!node(".ob-note").textContent!.includes("Smart approval"), "default permission note missing");
    });

    await check("completion summarizes choices, picks a folder and makes smart approval the default", async () => {
      await next("done");
      const rows = Object.fromEntries(all(".ob-summary-row").map((row) => [row.children[0]!.textContent, row.children[1]!.textContent]));
      assert(rows["Language"] === "English", `language row ${rows["Language"]}`);
      assert(rows["Info panel"] === "Floating panel", `layout row ${rows["Info panel"]}`);
      assert(rows["Tool calls"] === "Compact", `tools row ${rows["Tool calls"]}`);
      assert(rows["Provider"] === "Demo AI" && String(rows["Default model"]).startsWith("Demo Fast"), "provider/model rows wrong");
      assert(rows["Permissions"] === "Smart approval", `permissions row ${rows["Permissions"]}`);
      assert(rows["Memory"] === "Off" && rows["Resident Agent"] === "Standby" && rows["Automatic updates"] === "Off", `background rows ${JSON.stringify(rows)}`);
      await press(byText(".ob-tile", "Choose a project folder"));
      await until(() => byText(".ob-tile", "Choose a project folder").textContent!.includes("/workspace/Vela"), "folder shown");
      assert(fixture.state.folderDialogs === 1, "folder dialog not opened once");
      await press(byText(".ob-go", "Start using Vela"));
      await until(() => fixture.state.completed.length === 1, "onComplete called");
      assert(fixture.state.completed[0] === null, "plain finish must not open settings");
      assert(calls("setSandboxMode").length === 1 && calls("setSandboxMode")[0].arg === "smart" && fixture.state.sandbox === "smart", "factory 'ask' should switch to smart approval");
    });

    await check("connecting tools opens the MCP settings page and never overrides an explicit permission choice", async () => {
      fixture.reset({ sandbox: "full" }, "done");
      await reach("done");
      await until(() => !!all(".ob-summary-row").length, "summary rendered");
      await press(byText(".ob-tile", "Connect MCP"));
      await until(() => fixture.state.completed.length === 1, "onComplete called");
      assert(fixture.state.completed[0]?.settingsPage === "mcp", `expected mcp page, got ${JSON.stringify(fixture.state.completed[0])}`);
      assert(calls("setSandboxMode").length === 0 && fixture.state.sandbox === "full", "explicit full access must be kept");
    });

    await check("personalize can be skipped without saving, and earlier visited steps stay reachable", async () => {
      fixture.reset({ agent: { provider: "demo", modelId: "demo-pro", thinkingLevel: "low", newConversationSelection: "default", instructions: "keep" } }, "step-7");
      await reach("step-7");
      await until(() => node<HTMLTextAreaElement>("textarea.ob-lined").value === "keep", "saved instructions loaded");
      type(node<HTMLTextAreaElement>("textarea.ob-lined"), "discarded");
      await wait(20);
      await press(byText(".ob-link", "Skip this step", bar()));
      await reach("step-8");
      assert(calls("saveAgentSettings").length === 0, "skipping must not save instructions");
      const visitable = all<HTMLButtonElement>(".ob-route button", document).filter((item) => !item.disabled).length;
      assert(visitable === 7, `all steps before the current one should be visitable, got ${visitable}`);
      await press(back()); await reach("step-7");
      assert(node<HTMLTextAreaElement>("textarea.ob-lined").value === "discarded", "typed draft should survive back navigation");
    });

    await check("background step degrades gracefully when resident and update APIs are missing", async () => {
      const api = (window as any).vela;
      const saved = { resident: api.resident, updates: api.updates };
      api.resident = undefined; api.updates = undefined;
      fixture.reset({}, "step-8");
      await reach("step-8");
      const text = document.querySelector(".ob-scr.on")!.textContent!;
      assert(text.includes("no Resident Agent") && text.includes("unavailable"), "missing APIs should explain themselves");
      assert(!primary().disabled, "setup must still be completable");
      Object.assign(api, saved);
    });

    await check("without release notes the news page disappears and the tour leads straight to setup", async () => {
      fixture.reset({ notes: null }, "tour");
      await reach("tour");
      await wait(100);
      assert(!forward().textContent!.includes("See what"), "tour must not promise news when there are none");
      fixture.reset({ notes: null }, "news");
      await until(() => stage().dataset.screen === "step-1", "news falls through to step 1");
    });

    output.textContent += `\n${passed} onboarding checks passed.\n`;
    output.dataset.status = "passed";
  } catch (error) {
    output.textContent += `FAIL ${error instanceof Error ? error.stack : String(error)}\n`;
    output.dataset.status = "failed";
  }
}
