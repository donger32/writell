/*
 * Writell's own text cursor (Settings → Appearance → Text cursor): a line, thick line, block or underline
 * that can glide between letters and blink, fade or stay still. "Browser" keeps the normal one.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { getSettings, subscribeSettings } from '../settings';

export const SmoothCaret = Extension.create({
  name: 'smoothCaret',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('smoothCaret'),
      view(view: EditorView) {
        const el = document.createElement('div'); el.className = 'wr-caret'; el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        let shown = false;
        const place = (restart: boolean) => {
          const st = getSettings();
          const custom = st.caretStyle && st.caretStyle !== 'native';
          view.dom.classList.toggle('custom-caret', !!custom);
          const sel = view.state.selection;
          if (!custom || !view.editable || !view.hasFocus() || !sel.empty) { el.style.display = 'none'; shown = false; return; }
          let c: { left: number; top: number; bottom: number };
          try { c = view.coordsAtPos(sel.head); } catch { el.style.display = 'none'; return; }
          const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
          const fs = parseFloat(getComputedStyle(view.dom).fontSize) || 18;
          let w = 2, h = (c.bottom - c.top) / z, x = c.left / z, y = c.top / z;
          if (st.caretStyle === 'bar') w = 3;
          if (st.caretStyle === 'block' || st.caretStyle === 'underline') {
            let cw = fs * 0.55;
            try { const n = view.coordsAtPos(Math.min(view.state.doc.content.size, sel.head + 1)); if (Math.abs(n.top - c.top) < 2 && n.left > c.left) cw = (n.left - c.left) / z; } catch { /* end of text */ }
            w = Math.max(4, cw);
            if (st.caretStyle === 'underline') { y = y + h - 2; h = 2; }
          }
          el.className = `wr-caret ${st.caretStyle} ${st.caretBlink ?? 'blink'} ${st.caretColor === 'text' ? 'text' : 'accent'}${st.caretSmooth && shown ? ' smooth' : ''}`;
          el.style.display = 'block';
          el.style.width = w + 'px'; el.style.height = h + 'px';
          el.style.transform = `translate(${x}px, ${y}px)`;
          if (restart) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
          shown = true;
        };
        const onScroll = () => place(false), onFocus = () => place(true), onBlur = () => { el.style.display = 'none'; shown = false; };
        window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', onScroll);
        view.dom.addEventListener('focus', onFocus); view.dom.addEventListener('blur', onBlur);
        const unsub = subscribeSettings(() => place(true));
        requestAnimationFrame(() => place(true));
        return {
          update: (v, prev) => { if (!prev || !v.state.selection.eq(prev.selection) || !v.state.doc.eq(prev.doc)) requestAnimationFrame(() => place(true)); },
          destroy: () => { unsub(); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); view.dom.removeEventListener('focus', onFocus); view.dom.removeEventListener('blur', onBlur); view.dom.classList.remove('custom-caret'); el.remove(); },
        };
      },
    })];
  },
});
