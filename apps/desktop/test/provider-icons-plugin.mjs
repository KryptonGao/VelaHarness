/** esbuild UI 夹具使用真实内嵌图标，补齐 Vite 的静态 import.meta.glob 转换。 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
export const providerIconsPlugin = {
  name: "vela-test-provider-icons",
  setup(build) {
    build.onLoad({ filter: /[/\\]settings[/\\]models-parts\.tsx$/ }, ({ path }) => {
      const directory = resolve(dirname(path), "../../assets/providers");
      const urls = Object.fromEntries(readdirSync(directory).filter(name => name.endsWith(".svg")).map(name => [
        `../../assets/providers/${name}`, `data:image/svg+xml;base64,${readFileSync(resolve(directory, name)).toString("base64")}`,
      ]));
      const source = readFileSync(path, "utf8");
      const contents = source.replace(/import\.meta\.glob<string>\([^;]+\)/, JSON.stringify(urls));
      if (contents === source) throw new Error("无法转换供应商图标的 import.meta.glob");
      return { contents, loader: "tsx", resolveDir: dirname(path) };
    });
  },
};
