// El CSS (8 KB comprimido) va dentro del HTML: así no hay una petición que bloquee el primer pintado
// ni una cadena HTML → CSS → fuentes antes de ver la portada.
function inlineCss() {
  return {
    name: 'inline-css',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;                       // en desarrollo no se toca
      let out = html;
      for (const [file, asset] of Object.entries(ctx.bundle)) {
        if (!file.endsWith('.css')) continue;
        const re = new RegExp(`<link[^>]*rel="stylesheet"[^>]*href="[^"]*${file.split('/').pop()}"[^>]*>`);
        if (!re.test(out)) continue;
        out = out.replace(re, () => `<style>${asset.source}</style>`);
        delete ctx.bundle[file];
      }
      return out;
    },
  };
}

export default { plugins: [inlineCss()] };
