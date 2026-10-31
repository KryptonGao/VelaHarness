import { createContext, useContext, useMemo, type ReactNode } from "react";
import astro from "devicon/icons/astro/astro-original.svg";
import bash from "devicon/icons/bash/bash-original.svg";
import c from "devicon/icons/c/c-original.svg";
import cplusplus from "devicon/icons/cplusplus/cplusplus-original.svg";
import csharp from "devicon/icons/csharp/csharp-original.svg";
import css3 from "devicon/icons/css3/css3-original.svg";
import dart from "devicon/icons/dart/dart-original.svg";
import docker from "devicon/icons/docker/docker-original.svg";
import elixir from "devicon/icons/elixir/elixir-original.svg";
import go from "devicon/icons/go/go-original.svg";
import graphql from "devicon/icons/graphql/graphql-plain.svg";
import html5 from "devicon/icons/html5/html5-original.svg";
import java from "devicon/icons/java/java-original.svg";
import javascript from "devicon/icons/javascript/javascript-original.svg";
import json from "devicon/icons/json/json-original.svg";
import kotlin from "devicon/icons/kotlin/kotlin-original.svg";
import lua from "devicon/icons/lua/lua-original.svg";
import markdown from "devicon/icons/markdown/markdown-original.svg";
import php from "devicon/icons/php/php-original.svg";
import powershell from "devicon/icons/powershell/powershell-original.svg";
import python from "devicon/icons/python/python-original.svg";
import ruby from "devicon/icons/ruby/ruby-original.svg";
import rust from "devicon/icons/rust/rust-original.svg";
import sass from "devicon/icons/sass/sass-original.svg";
import scala from "devicon/icons/scala/scala-original.svg";
import svelte from "devicon/icons/svelte/svelte-original.svg";
import swift from "devicon/icons/swift/swift-original.svg";
import typescript from "devicon/icons/typescript/typescript-original.svg";
import vue from "devicon/icons/vuejs/vuejs-original.svg";
import xml from "devicon/icons/xml/xml-original.svg";
import yaml from "devicon/icons/yaml/yaml-original.svg";
import zsh from "devicon/icons/zsh/zsh-original.svg";
import materialAstro from "material-icon-theme/icons/astro.svg";
import materialC from "material-icon-theme/icons/c.svg";
import materialConsole from "material-icon-theme/icons/console.svg";
import materialCpp from "material-icon-theme/icons/cpp.svg";
import materialCsharp from "material-icon-theme/icons/csharp.svg";
import materialCss from "material-icon-theme/icons/css.svg";
import materialDart from "material-icon-theme/icons/dart.svg";
import materialDocker from "material-icon-theme/icons/docker.svg";
import materialElixir from "material-icon-theme/icons/elixir.svg";
import materialFile from "material-icon-theme/icons/file.svg";
import materialGo from "material-icon-theme/icons/go.svg";
import materialGraphql from "material-icon-theme/icons/graphql.svg";
import materialH from "material-icon-theme/icons/h.svg";
import materialHpp from "material-icon-theme/icons/hpp.svg";
import materialHtml from "material-icon-theme/icons/html.svg";
import materialJava from "material-icon-theme/icons/java.svg";
import materialJavascript from "material-icon-theme/icons/javascript.svg";
import materialJson from "material-icon-theme/icons/json.svg";
import materialKotlin from "material-icon-theme/icons/kotlin.svg";
import materialLua from "material-icon-theme/icons/lua.svg";
import materialMarkdown from "material-icon-theme/icons/markdown.svg";
import materialMdx from "material-icon-theme/icons/mdx.svg";
import materialPhp from "material-icon-theme/icons/php.svg";
import materialPowershell from "material-icon-theme/icons/powershell.svg";
import materialPython from "material-icon-theme/icons/python.svg";
import materialReact from "material-icon-theme/icons/react.svg";
import materialReactTs from "material-icon-theme/icons/react_ts.svg";
import materialRuby from "material-icon-theme/icons/ruby.svg";
import materialRust from "material-icon-theme/icons/rust.svg";
import materialSass from "material-icon-theme/icons/sass.svg";
import materialScala from "material-icon-theme/icons/scala.svg";
import materialSvelte from "material-icon-theme/icons/svelte.svg";
import materialSwift from "material-icon-theme/icons/swift.svg";
import materialTypescript from "material-icon-theme/icons/typescript.svg";
import materialVue from "material-icon-theme/icons/vue.svg";
import materialXml from "material-icon-theme/icons/xml.svg";
import materialYaml from "material-icon-theme/icons/yaml.svg";
import catppuccinAstro from "../assets/catppuccin-icons/astro.svg";
import catppuccinBash from "../assets/catppuccin-icons/bash.svg";
import catppuccinC from "../assets/catppuccin-icons/c.svg";
import catppuccinCHeader from "../assets/catppuccin-icons/c-header.svg";
import catppuccinCpp from "../assets/catppuccin-icons/cpp.svg";
import catppuccinCppHeader from "../assets/catppuccin-icons/cpp-header.svg";
import catppuccinCsharp from "../assets/catppuccin-icons/csharp.svg";
import catppuccinCss from "../assets/catppuccin-icons/css.svg";
import catppuccinDart from "../assets/catppuccin-icons/dart.svg";
import catppuccinDocker from "../assets/catppuccin-icons/docker.svg";
import catppuccinElixir from "../assets/catppuccin-icons/elixir.svg";
import catppuccinGo from "../assets/catppuccin-icons/go.svg";
import catppuccinGraphql from "../assets/catppuccin-icons/graphql.svg";
import catppuccinHtml from "../assets/catppuccin-icons/html.svg";
import catppuccinJava from "../assets/catppuccin-icons/java.svg";
import catppuccinJavascript from "../assets/catppuccin-icons/javascript.svg";
import catppuccinJavascriptReact from "../assets/catppuccin-icons/javascript-react.svg";
import catppuccinJson from "../assets/catppuccin-icons/json.svg";
import catppuccinKotlin from "../assets/catppuccin-icons/kotlin.svg";
import catppuccinLua from "../assets/catppuccin-icons/lua.svg";
import catppuccinMarkdown from "../assets/catppuccin-icons/markdown.svg";
import catppuccinMdx from "../assets/catppuccin-icons/markdown-mdx.svg";
import catppuccinPhp from "../assets/catppuccin-icons/php.svg";
import catppuccinPowershell from "../assets/catppuccin-icons/powershell.svg";
import catppuccinPython from "../assets/catppuccin-icons/python.svg";
import catppuccinRuby from "../assets/catppuccin-icons/ruby.svg";
import catppuccinRust from "../assets/catppuccin-icons/rust.svg";
import catppuccinSass from "../assets/catppuccin-icons/sass.svg";
import catppuccinScala from "../assets/catppuccin-icons/scala.svg";
import catppuccinSvelte from "../assets/catppuccin-icons/svelte.svg";
import catppuccinSwift from "../assets/catppuccin-icons/swift.svg";
import catppuccinText from "../assets/catppuccin-icons/text.svg";
import catppuccinTypescript from "../assets/catppuccin-icons/typescript.svg";
import catppuccinTypescriptReact from "../assets/catppuccin-icons/typescript-react.svg";
import catppuccinVue from "../assets/catppuccin-icons/vue.svg";
import catppuccinXml from "../assets/catppuccin-icons/xml.svg";
import catppuccinYaml from "../assets/catppuccin-icons/yaml.svg";
import type { ColorScheme } from "../themes";
import type { FileIconTheme } from "../hooks/usePreferences";
import {
  pierreFallbackIcon,
  pierreIconNameByExtension,
  pierreIconNameByFileName,
  pierreIconsDark,
  pierreIconsLight,
} from "./pierre-file-icons";

const FileIconThemeContext = createContext<{ theme: FileIconTheme; scheme: ColorScheme }>({ theme: "pierre", scheme: "dark" });

// scheme 只影响 Pierre：它的图标把颜色写死在 SVG 里，亮暗两套各取 600 / 400 色阶。
export function FileIconThemeProvider({
  value,
  scheme = "dark",
  children,
}: {
  value: FileIconTheme;
  scheme?: ColorScheme;
  children: ReactNode;
}) {
  const context = useMemo(() => ({ theme: value, scheme }), [value, scheme]);
  return <FileIconThemeContext.Provider value={context}>{children}</FileIconThemeContext.Provider>;
}

const fileIconsByExtension: Record<string, string> = {
  ts: typescript,
  tsx: typescript,
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  jsx: javascript,
  py: python,
  rs: rust,
  go,
  java,
  php,
  rb: ruby,
  swift,
  kt: kotlin,
  kts: kotlin,
  c,
  h: c,
  cc: cplusplus,
  cpp: cplusplus,
  cxx: cplusplus,
  hpp: cplusplus,
  cs: csharp,
  dart,
  ex: elixir,
  exs: elixir,
  scala,
  lua,
  sh: bash,
  bash,
  zsh,
  ps1: powershell,
  html: html5,
  htm: html5,
  css: css3,
  scss: sass,
  sass,
  json,
  yaml,
  yml: yaml,
  md: markdown,
  mdx: markdown,
  xml,
  graphql,
  gql: graphql,
  vue,
  svelte,
  astro,
  dockerfile: docker,
};

const fileIconsByName: Record<string, string> = {
  dockerfile: docker,
  ".dockerignore": docker,
};

const materialIconsByExtension: Record<string, string> = {
  ts: materialTypescript,
  tsx: materialReactTs,
  js: materialJavascript,
  mjs: materialJavascript,
  cjs: materialJavascript,
  jsx: materialReact,
  py: materialPython,
  rs: materialRust,
  go: materialGo,
  java: materialJava,
  php: materialPhp,
  rb: materialRuby,
  swift: materialSwift,
  kt: materialKotlin,
  kts: materialKotlin,
  c: materialC,
  h: materialH,
  cc: materialCpp,
  cpp: materialCpp,
  cxx: materialCpp,
  hpp: materialHpp,
  cs: materialCsharp,
  dart: materialDart,
  ex: materialElixir,
  exs: materialElixir,
  scala: materialScala,
  lua: materialLua,
  sh: materialConsole,
  bash: materialConsole,
  zsh: materialConsole,
  ps1: materialPowershell,
  html: materialHtml,
  htm: materialHtml,
  css: materialCss,
  scss: materialSass,
  sass: materialSass,
  json: materialJson,
  yaml: materialYaml,
  yml: materialYaml,
  md: materialMarkdown,
  mdx: materialMdx,
  xml: materialXml,
  graphql: materialGraphql,
  gql: materialGraphql,
  vue: materialVue,
  svelte: materialSvelte,
  astro: materialAstro,
  dockerfile: materialDocker,
};

const materialIconsByName: Record<string, string> = {
  dockerfile: materialDocker,
  ".dockerignore": materialDocker,
};

const catppuccinIconsByExtension: Record<string, string> = {
  ts: catppuccinTypescript,
  tsx: catppuccinTypescriptReact,
  js: catppuccinJavascript,
  mjs: catppuccinJavascript,
  cjs: catppuccinJavascript,
  jsx: catppuccinJavascriptReact,
  py: catppuccinPython,
  rs: catppuccinRust,
  go: catppuccinGo,
  java: catppuccinJava,
  php: catppuccinPhp,
  rb: catppuccinRuby,
  swift: catppuccinSwift,
  kt: catppuccinKotlin,
  kts: catppuccinKotlin,
  c: catppuccinC,
  h: catppuccinCHeader,
  cc: catppuccinCpp,
  cpp: catppuccinCpp,
  cxx: catppuccinCpp,
  hpp: catppuccinCppHeader,
  cs: catppuccinCsharp,
  dart: catppuccinDart,
  ex: catppuccinElixir,
  exs: catppuccinElixir,
  scala: catppuccinScala,
  lua: catppuccinLua,
  sh: catppuccinBash,
  bash: catppuccinBash,
  zsh: catppuccinBash,
  ps1: catppuccinPowershell,
  html: catppuccinHtml,
  htm: catppuccinHtml,
  css: catppuccinCss,
  scss: catppuccinSass,
  sass: catppuccinSass,
  json: catppuccinJson,
  yaml: catppuccinYaml,
  yml: catppuccinYaml,
  md: catppuccinMarkdown,
  mdx: catppuccinMdx,
  xml: catppuccinXml,
  graphql: catppuccinGraphql,
  gql: catppuccinGraphql,
  vue: catppuccinVue,
  svelte: catppuccinSvelte,
  astro: catppuccinAstro,
  dockerfile: catppuccinDocker,
};

const catppuccinIconsByName: Record<string, string> = {
  dockerfile: catppuccinDocker,
  ".dockerignore": catppuccinDocker,
};

export function FileTypeIcon({ path }: { path: string }) {
  const { theme, scheme } = useContext(FileIconThemeContext);
  const fileName = path.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? "";
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : fileName;
  let icon: string | undefined;
  switch (theme) {
    case "catppuccin":
      icon = catppuccinIconsByName[fileName] ?? catppuccinIconsByExtension[extension] ?? catppuccinText;
      break;
    case "material":
      icon = materialIconsByName[fileName] ?? materialIconsByExtension[extension] ?? materialFile;
      break;
    case "devicon":
      icon = fileIconsByName[fileName] ?? fileIconsByExtension[extension];
      break;
    case "pierre": {
      const icons = scheme === "light" ? pierreIconsLight : pierreIconsDark;
      icon = icons[pierreIconNameByFileName[fileName] ?? pierreIconNameByExtension[extension] ?? pierreFallbackIcon];
      break;
    }
  }
  if (!icon) return null;

  return <img className="file-type-icon" src={icon} alt="" aria-hidden="true" />;
}
