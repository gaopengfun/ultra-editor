import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, type ResizableNodeView } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { ImageOptions } from '@tiptap/extension-image';
import { DecorationSet } from '@tiptap/pm/view';
import { DEFAULT_IMAGE_RESIZE, ImageFigure } from './image-figure';

const env = vi.hoisted(() => ({ browser: true }));

vi.mock('../utils/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/env')>();
  return { ...actual, isBrowser: () => env.browser };
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function makeEditor(content = '', options: Partial<ImageOptions> = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      ImageFigure.configure({ inline: false, resize: { ...DEFAULT_IMAGE_RESIZE }, ...options })
    ]
  });
}

const container = (editor: Editor) =>
  editor.view.dom.querySelector<HTMLElement>('[data-resize-container]');

const image = (editor: Editor) =>
  editor.view.dom.querySelector<HTMLImageElement>('[data-resize-container] img');

const figcaption = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.ue-figcaption');

function drag(handle: HTMLElement, fromX: number, toX: number) {
  handle.dispatchEvent(new MouseEvent('mousedown', { clientX: fromX, clientY: 0, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: toX, clientY: 0, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

let restoreLayout: () => void;

beforeEach(() => {
  document.body.innerHTML = '';

  // jsdom runs no layout, so offsetWidth/offsetHeight are hardcoded to 0 — and
  // that is exactly what the resize node view measures to size and commit a
  // drag. Report the inline size instead, which is what a browser would.
  const proto = window.HTMLElement.prototype;
  const saved = {
    offsetWidth: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
    offsetHeight: Object.getOwnPropertyDescriptor(proto, 'offsetHeight')
  };
  const fromStyle = (dimension: 'width' | 'height') => ({
    configurable: true,
    get(this: HTMLElement) {
      return parseFloat(this.style[dimension]) || 0;
    }
  });
  Object.defineProperty(proto, 'offsetWidth', fromStyle('width'));
  Object.defineProperty(proto, 'offsetHeight', fromStyle('height'));

  restoreLayout = () => {
    Object.defineProperty(proto, 'offsetWidth', saved.offsetWidth!);
    Object.defineProperty(proto, 'offsetHeight', saved.offsetHeight!);
  };
});

afterEach(() => {
  restoreLayout();
  env.browser = true;
});

describe('ImageFigure serialisation', () => {
  it('round-trips a left-aligned figure with a caption', () => {
    const editor = makeEditor(
      '<figure class="ue-figure" data-align="left"><img src="/a.png" alt="图" title="标题"><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('<figure class="ue-figure" data-align="left">');
    expect(html).toContain('src="/a.png"');
    expect(html).toContain('alt="图"');
    expect(html).toContain('title="标题"');
    expect(html).toContain('<figcaption>说明</figcaption>');
  });

  it('writes a caption with no alignment as a figure with no data-align', () => {
    const editor = makeEditor(
      '<figure class="ue-figure"><img src="/a.png"><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('<figure class="ue-figure">');
    expect(html).not.toContain('data-align');
    expect(html).toContain('<figcaption>说明</figcaption>');
  });

  it('writes an alignment with no caption as a bare img, not an empty figure', () => {
    const editor = makeEditor('<img src="/a.png" data-align="right">');
    const html = editor.getHTML();

    expect(html).toContain('data-align="right"');
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('<figcaption');
  });

  it('leaves a plain image plain', () => {
    const editor = makeEditor('<img src="/a.png">');
    const html = editor.getHTML();

    expect(html).toContain('<img src="/a.png">');
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('data-align');
  });

  it('parses a figure with no figcaption as an image with no caption', () => {
    const editor = makeEditor('<figure class="ue-figure"><img src="/a.png"></figure>');
    const html = editor.getHTML();

    expect(html).toContain('<img src="/a.png">');
    expect(html).not.toContain('<figure');
  });

  it('round-trips an inline width and height', () => {
    const editor = makeEditor('<img src="/a.png" width="320" height="200">');
    const html = editor.getHTML();

    expect(html).toContain('width="320"');
    expect(html).toContain('height="200"');
  });

  it('refuses a figure that wraps no image at all', () => {
    const editor = makeEditor(
      '<figure class="ue-figure"><figcaption>孤儿说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).not.toContain('<figure');
    expect(html).not.toContain('<img');
  });

  it('keeps a figure whose image never got a src', () => {
    const editor = makeEditor(
      '<figure class="ue-figure"><img><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('<figure class="ue-figure">');
    expect(html).toContain('<figcaption>说明</figcaption>');
    expect(html).not.toContain('src=');
  });
});

describe('ImageFigure image-url allowlist', () => {
  it('allows a base64 image payload inside a figure', () => {
    const editor = makeEditor(
      `<figure class="ue-figure"><img src="${PNG}"><figcaption>内嵌</figcaption></figure>`
    );

    expect(editor.getHTML()).toContain(`src="${PNG}"`);
  });

  it('refuses a data: URL that is not an image, which is the point of the allowlist', () => {
    const editor = makeEditor(
      '<figure class="ue-figure"><img src="data:text/html;base64,PHNjcmlwdD4="><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('<img');
  });

  it('refuses a scripting-scheme src while parsing', () => {
    const editor = makeEditor(
      '<figure class="ue-figure"><img src="javascript:alert(1)"><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
  });

  it('strips a scripting-scheme src that was set programmatically, past the parser', () => {
    const editor = makeEditor('<p></p>');
    editor.commands.setImage({ src: 'javascript:alert(1)' });

    const html = editor.getHTML();
    expect(html).toContain('<img>');
    expect(html).not.toContain('javascript:');
    // The node view must not point the live <img> at it either.
    expect(image(editor)?.hasAttribute('src')).toBe(false);
  });

  it('accepts a bare base64 image only when the host opts in', () => {
    expect(makeEditor(`<img src="${PNG}">`).getHTML()).not.toContain('<img');

    const optedIn = makeEditor(`<img src="${PNG}">`, { allowBase64: true });
    expect(optedIn.getHTML()).toContain(`src="${PNG}"`);
  });

  it('still refuses a non-image data: URL when base64 is opted in', () => {
    const editor = makeEditor('<img src="data:text/html;base64,PHNjcmlwdD4=">', {
      allowBase64: true
    });

    expect(editor.getHTML()).not.toContain('<img');
  });
});

describe('ImageFigure resize node view', () => {
  it('draws eight drag handles around the image while editing', () => {
    const editor = makeEditor('<img src="/a.png" alt="图">');

    expect(container(editor)).not.toBeNull();
    expect(container(editor)?.querySelectorAll('[data-resize-handle]')).toHaveLength(8);
    expect(image(editor)?.getAttribute('alt')).toBe('图');
    expect(image(editor)?.getAttribute('src')).toBe('/a.png');
  });

  it('keeps the editing chrome out of the serialised HTML', () => {
    const editor = makeEditor(
      '<figure class="ue-figure" data-align="center"><img src="/a.png"><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).not.toContain('data-resize-container');
    expect(html).not.toContain('data-resize-handle');
    expect(html).not.toContain('ue-figcaption');
    expect(html).toContain('<figure class="ue-figure" data-align="center">');
  });

  it('commits a dragged handle back to the node, aspect ratio locked', () => {
    const editor = makeEditor('<img src="/a.png" width="200" height="100">');
    const handle = container(editor)?.querySelector<HTMLElement>('[data-resize-handle="right"]');

    drag(handle!, 300, 400);

    const html = editor.getHTML();
    expect(html).toContain('width="300"');
    // 2:1 was locked in by DEFAULT_IMAGE_RESIZE, so height follows width.
    expect(html).toContain('height="150"');
    expect(image(editor)?.style.width).toBe('300px');
  });

  it('shows the caption on the editing surface, where renderHTML never runs', () => {
    const editor = makeEditor(
      '<figure class="ue-figure"><img src="/a.png"><figcaption>说明</figcaption></figure>'
    );

    expect(figcaption(editor)?.textContent).toBe('说明');
    expect(figcaption(editor)?.style.display).toBe('');
  });

  it('hides the caption slot when the image has none', () => {
    const editor = makeEditor('<img src="/a.png">');

    expect(figcaption(editor)?.textContent).toBe('');
    expect(figcaption(editor)?.style.display).toBe('none');
  });

  it('justifies the container from the alignment', () => {
    expect(container(makeEditor('<img src="/a.png" data-align="center">'))?.style.justifyContent) //
      .toBe('center');
    expect(container(makeEditor('<img src="/a.png" data-align="left">'))?.style.justifyContent) //
      .toBe('flex-start');
    expect(container(makeEditor('<img src="/a.png" data-align="right">'))?.style.justifyContent) //
      .toBe('flex-end');
    expect(container(makeEditor('<img src="/a.png">'))?.style.justifyContent).toBe('');
    // An alignment written by hand into the HTML need not be one we know.
    expect(container(makeEditor('<img src="/a.png" data-align="middle">'))?.style.justifyContent) //
      .toBe('flex-start');
  });

  it('follows an attribute update without waiting for a re-render', () => {
    const editor = makeEditor('<img src="/a.png">');
    editor.commands.setNodeSelection(0);

    editor.commands.updateAttributes('image', {
      src: '/b.png',
      caption: '新说明',
      align: 'right',
      width: 320,
      height: 180
    });

    expect(image(editor)?.getAttribute('src')).toBe('/b.png');
    expect(image(editor)?.style.width).toBe('320px');
    expect(image(editor)?.style.height).toBe('180px');
    expect(figcaption(editor)?.textContent).toBe('新说明');
    expect(figcaption(editor)?.style.display).toBe('');
    expect(container(editor)?.style.justifyContent).toBe('flex-end');
  });

  it('clears the chrome again when the attributes are taken back off', () => {
    const editor = makeEditor(
      '<figure class="ue-figure" data-align="right"><img src="/a.png" width="320"><figcaption>说明</figcaption></figure>'
    );
    editor.commands.setNodeSelection(0);

    editor.commands.updateAttributes('image', {
      caption: null,
      align: null,
      width: null,
      height: null
    });

    expect(figcaption(editor)?.style.display).toBe('none');
    expect(container(editor)?.style.justifyContent).toBe('');
    expect(image(editor)?.style.width).toBe('');
    expect(image(editor)?.style.height).toBe('');
  });

  it('refuses to repoint the live img at an unsafe src on update', () => {
    const editor = makeEditor('<img src="/a.png">');
    editor.commands.setNodeSelection(0);

    editor.commands.updateAttributes('image', { src: 'javascript:alert(1)', align: 'middle' });

    expect(image(editor)?.getAttribute('src')).toBe('/a.png');
    expect(container(editor)?.style.justifyContent).toBe('flex-start');
  });

  it('leaves the img alone when an update repeats the src it already has', () => {
    const editor = makeEditor('<img src="/a.png">');
    editor.commands.setNodeSelection(0);

    editor.commands.updateAttributes('image', { src: '/a.png', caption: '说明' });

    expect(image(editor)?.getAttribute('src')).toBe('/a.png');
    expect(figcaption(editor)?.textContent).toBe('说明');
  });

  it('reveals the image once it has decoded', () => {
    const editor = makeEditor('<img src="/a.png">');

    // Hidden until then, so a half-loaded image cannot flash at the wrong size.
    expect(container(editor)?.style.visibility).toBe('hidden');
    expect(container(editor)?.style.pointerEvents).toBe('none');

    image(editor)?.dispatchEvent(new Event('load'));

    expect(container(editor)?.style.visibility).toBe('');
    expect(container(editor)?.style.pointerEvents).toBe('');
  });

  it('reveals the image even when it fails to load, so a broken src is visible', () => {
    const editor = makeEditor('<img src="/missing.png">');
    image(editor)?.dispatchEvent(new Event('error'));

    expect(container(editor)?.style.visibility).toBe('');
  });

  it('reveals an image that is already complete on the first paint', () => {
    // No src to fetch, so the browser reports it complete straight away.
    const editor = makeEditor(
      '<figure class="ue-figure"><img><figcaption>说明</figcaption></figure>'
    );

    expect(image(editor)?.complete).toBe(true);
    expect(container(editor)?.style.visibility).toBe('');
  });
});

describe('ImageFigure without a resize node view', () => {
  it('renders a plain img when resizing is switched off', () => {
    const editor = makeEditor('<img src="/a.png">', { resize: false });

    expect(container(editor)).toBeNull();
    expect(editor.view.dom.querySelector('img')).not.toBeNull();
    expect(editor.getHTML()).toContain('<img src="/a.png">');
  });

  it('renders a plain img when the resize config is present but disabled', () => {
    const editor = makeEditor('<img src="/a.png">', { resize: { enabled: false } });

    expect(container(editor)).toBeNull();
    expect(editor.view.dom.querySelector('img')).not.toBeNull();
  });

  it('mounts no node view outside a browser, so the SDK survives SSR', () => {
    env.browser = false;
    const editor = makeEditor('<img src="/a.png">');

    expect(container(editor)).toBeNull();
    expect(editor.getHTML()).toContain('<img src="/a.png">');
  });
});

// ProseMirror guards both of these before it ever reaches our callbacks: it will
// not call `update` across node types, and it destroys the node view — dropping
// the drag listeners with it — when the node leaves the document. They are only
// reachable by holding the node view directly, which is what these two do.
describe('ImageFigure node view guards', () => {
  function detachedNodeView(editor: Editor) {
    const nodeViews = editor.view.someProp('nodeViews')!;
    const node = editor.state.doc.firstChild!;
    const view = nodeViews.image(
      node,
      editor.view,
      () => undefined,
      [],
      DecorationSet.empty
    ) as ResizableNodeView;
    document.body.appendChild(view.dom);
    return view;
  }

  it('commits nothing when the image is no longer in the document', () => {
    const editor = makeEditor('<img src="/a.png" width="200" height="100">');
    const nodeView = detachedNodeView(editor);
    const handle = nodeView.dom.querySelector<HTMLElement>('[data-resize-handle="right"]');

    drag(handle!, 300, 400);

    expect(editor.getHTML()).toContain('width="200"');
    expect(editor.getHTML()).not.toContain('width="300"');
  });

  it('refuses an update for a node of a different type', () => {
    const editor = makeEditor('<img src="/a.png">');
    const nodeView = detachedNodeView(editor);
    const paragraph = editor.state.schema.nodes.paragraph.create();

    expect(nodeView.onUpdate?.(paragraph, [], DecorationSet.empty)).toBe(false);
  });
});
