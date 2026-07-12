import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { createUltraKit, type UltraKitOptions } from '../kit';
import type { UploadHandler } from '../upload';
import type { UploadError } from './image-upload';

/** Let the upload promise and every `.then` chained behind it settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeEditor(options: UltraKitOptions = {}, content = '<p>正文</p>') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, content, extensions: createUltraKit(options) });
  // Park the cursor at the end of the paragraph so an upload lands after it.
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}

const imageFile = (name = 'a.png', type = 'image/png', bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type });

interface FakeItem {
  kind: string;
  getAsFile: () => File | null;
}

const fileItem = (file: File | null): FakeItem => ({ kind: 'file', getAsFile: () => file });

/**
 * jsdom cannot build a ClipboardEvent that carries files, and a real `paste` on
 * the editor DOM would need a working clipboard API to get that far. Hand the
 * event to the same prop prosemirror-view would call, through the same lookup.
 * `getData` is here because the paste travels through every other handler too.
 */
function clipboardEvent(items?: FakeItem[]): ClipboardEvent {
  return {
    clipboardData: items ? { items, getData: () => '' } : undefined,
    preventDefault: vi.fn()
  } as unknown as ClipboardEvent;
}

function dropEvent(files?: File[], clientX = 40, clientY = 60): DragEvent {
  return {
    dataTransfer: files ? { files } : undefined,
    clientX,
    clientY,
    preventDefault: vi.fn()
  } as unknown as DragEvent;
}

function paste(view: EditorView, event: ClipboardEvent): boolean {
  let handled = false;
  view.someProp('handlePaste', (fn) => {
    const result = fn(view, event, Slice.empty);
    if (result) handled = true;
    return result;
  });
  return handled;
}

function drop(view: EditorView, event: DragEvent): boolean {
  let handled = false;
  view.someProp('handleDrop', (fn) => {
    const result = fn(view, event, Slice.empty, false);
    if (result) handled = true;
    return result;
  });
  return handled;
}

const placeholders = (editor: Editor) =>
  editor.view.dom.querySelectorAll('.ue-upload-placeholder').length;

let upload: Mock<UploadHandler>;
let onUploadError: Mock<(error: UploadError) => void>;

beforeEach(() => {
  document.body.innerHTML = '';
  upload = vi.fn<UploadHandler>(async () => 'https://cdn.test/a.png');
  onUploadError = vi.fn<(error: UploadError) => void>();
});

describe('ImageUpload commands', () => {
  it('sends the file to the injected handler and inserts the returned URL', async () => {
    const editor = makeEditor({ upload: { upload }, onUploadError });

    expect(editor.commands.uploadImages([imageFile()])).toBe(true);
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
    const [blob, filename] = upload.mock.calls[0];
    expect(blob).toBeInstanceOf(File);
    expect(filename).toBe('a.png');

    const html = editor.getHTML();
    expect(html).toContain('src="https://cdn.test/a.png"');
    expect(html).toContain('alt="a.png"');
    expect(onUploadError).not.toHaveBeenCalled();
  });

  it('refuses an empty file list', () => {
    const editor = makeEditor({ upload: { upload } });

    expect(editor.commands.uploadImages([])).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not upload while merely probing whether it could', async () => {
    const editor = makeEditor({ upload: { upload } });
    const before = editor.getHTML();

    // `can()` runs the command with no dispatch. Uploading there would fire a
    // real request just to answer "is this possible?".
    expect(editor.can().uploadImages([imageFile()])).toBe(true);
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe(before);
  });
});

describe('ImageUpload paste', () => {
  it('uploads an image pasted from the clipboard', async () => {
    const editor = makeEditor({ upload: { upload } });
    const event = clipboardEvent([fileItem(imageFile('shot.png'))]);

    expect(paste(editor.view, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toBe('shot.png');
    expect(editor.getHTML()).toContain('src="https://cdn.test/a.png"');
  });

  it('leaves a nameless clipboard image without an alt', async () => {
    const editor = makeEditor({ upload: { upload } });

    paste(editor.view, clipboardEvent([fileItem(imageFile(''))]));
    await flush();

    const html = editor.getHTML();
    expect(html).toContain('src="https://cdn.test/a.png"');
    expect(html).not.toContain('alt=');
  });

  it('ignores a pasted text file so the default paste still runs', async () => {
    const editor = makeEditor({ upload: { upload }, onUploadError });
    const before = editor.getHTML();
    const text = new File(['hi'], 'a.txt', { type: 'text/plain' });

    const event = clipboardEvent([fileItem(text)]);
    expect(paste(editor.view, event)).toBe(false);
    await flush();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(onUploadError).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe(before);
  });

  it('ignores clipboard entries that are not files', () => {
    const editor = makeEditor({ upload: { upload } });

    expect(paste(editor.view, clipboardEvent([{ kind: 'string', getAsFile: () => null }]))).toBe(
      false
    );
    // A file entry the browser refuses to hand over is not a file either.
    expect(paste(editor.view, clipboardEvent([fileItem(null)]))).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('ignores a paste that carries no clipboard data at all', () => {
    const editor = makeEditor({ upload: { upload } });

    expect(paste(editor.view, clipboardEvent())).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('ImageUpload drop', () => {
  it('uploads an image dropped at the position under the pointer', async () => {
    const editor = makeEditor({ upload: { upload } }, '<p>第一段</p><p>第二段</p>');
    // jsdom does no layout, so posAtCoords can never resolve a real point.
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 });

    const event = dropEvent([imageFile('dropped.png')]);
    expect(drop(editor.view, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(editor.view.posAtCoords).toHaveBeenCalledWith({ left: 40, top: 60 });

    // Dropped on the first paragraph, not at the selection, which sits in the second.
    const html = editor.getHTML();
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('第一段'));
  });

  it('falls back to the selection when the drop point resolves to nothing', async () => {
    const editor = makeEditor({ upload: { upload } });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);

    expect(drop(editor.view, dropEvent([imageFile()]))).toBe(true);
    await flush();

    // Selection sits at the end of the paragraph, so the image follows it.
    expect(editor.getHTML()).toBe(
      '<p>正文</p><img src="https://cdn.test/a.png" alt="a.png"><p></p>'
    );
  });

  it('ignores a dropped text file and a drop with no files', () => {
    const editor = makeEditor({ upload: { upload } });
    const text = new File(['hi'], 'a.txt', { type: 'text/plain' });

    expect(drop(editor.view, dropEvent([text]))).toBe(false);
    expect(drop(editor.view, dropEvent())).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('ImageUpload rejection', () => {
  it('rejects a file whose type is not accepted, without touching the document', async () => {
    const editor = makeEditor({ upload: { upload }, onUploadError });
    const before = editor.getHTML();

    editor.commands.uploadImages([new File(['hi'], 'a.txt', { type: 'text/plain' })]);
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(onUploadError).toHaveBeenCalledTimes(1);
    const error = onUploadError.mock.calls[0][0];
    expect(error.code).toBe('unsupported');
    expect(error.file).toBeInstanceOf(File);
    expect(error.max).toBe('5.00MB');
    expect(editor.getHTML()).toBe(before);
    expect(placeholders(editor)).toBe(0);
  });

  it('rejects a file over the size limit and reports both sizes in human units', async () => {
    const editor = makeEditor({
      upload: { upload, maxSize: 1024 * 1024 },
      onUploadError
    });
    const before = editor.getHTML();

    editor.commands.uploadImages([imageFile('big.png', 'image/png', 2 * 1024 * 1024)]);
    await flush();

    expect(upload).not.toHaveBeenCalled();
    const error = onUploadError.mock.calls[0][0];
    expect(error.code).toBe('too-large');
    expect(error.size).toBe('2.00MB');
    expect(error.max).toBe('1.00MB');
    expect(editor.getHTML()).toBe(before);
    expect(placeholders(editor)).toBe(0);
  });

  it('respects a narrowed accept list', async () => {
    const editor = makeEditor({
      upload: { upload, accept: ['image/png'] },
      onUploadError
    });

    paste(editor.view, clipboardEvent([fileItem(imageFile('anim.gif', 'image/gif'))]));
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(onUploadError.mock.calls[0][0].code).toBe('unsupported');
  });

  it('stays quiet when the host supplied no error handler', async () => {
    const editor = makeEditor({ upload: { upload, maxSize: 4 } });
    const before = editor.getHTML();

    expect(() => editor.commands.uploadImages([imageFile()])).not.toThrow();
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe(before);
  });
});

describe('ImageUpload placeholder', () => {
  it('shows a placeholder while the upload is in flight and swaps it for the image', async () => {
    const pending = deferred<string>();
    const editor = makeEditor({ upload: { upload: () => pending.promise } });

    editor.commands.uploadImages([imageFile()]);
    expect(placeholders(editor)).toBe(1);
    // The placeholder is a decoration, so it never reaches the serialised HTML.
    expect(editor.getHTML()).toBe('<p>正文</p>');

    pending.resolve('https://cdn.test/done.png');
    await flush();

    expect(placeholders(editor)).toBe(0);
    expect(editor.getHTML()).toContain('src="https://cdn.test/done.png"');
  });

  it('keeps two in-flight uploads on their own placeholders, whatever order they land in', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    upload = vi
      .fn<UploadHandler>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const editor = makeEditor({ upload: { upload } }, '<p>第一段</p><p>第二段</p>');

    editor.commands.setTextSelection(4);
    editor.commands.uploadImages([imageFile('a.png')]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.uploadImages([imageFile('b.png')]);
    expect(placeholders(editor)).toBe(2);

    // The second upload finishes first: it must not consume the first one's spot.
    second.resolve('https://cdn.test/second.png');
    await flush();
    expect(placeholders(editor)).toBe(1);

    first.resolve('https://cdn.test/first.png');
    await flush();

    const html = editor.getHTML();
    expect(placeholders(editor)).toBe(0);
    expect(html.indexOf('https://cdn.test/first.png')).toBeLessThan(
      html.indexOf('https://cdn.test/second.png')
    );
  });

  it('leaves no debris behind when the upload fails', async () => {
    const pending = deferred<string>();
    const editor = makeEditor({ upload: { upload: () => pending.promise }, onUploadError });
    const before = editor.getHTML();

    editor.commands.uploadImages([imageFile()]);
    expect(placeholders(editor)).toBe(1);

    pending.reject(new Error('507'));
    await flush();

    expect(placeholders(editor)).toBe(0);
    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).not.toContain('<img');
    const error = onUploadError.mock.calls[0][0];
    expect(error.code).toBe('failed');
    expect(error.size).toBe('0.00MB');
  });

  it('drops the result when the placeholder is gone by the time it lands', async () => {
    const pending = deferred<string>();
    const editor = makeEditor({ upload: { upload: () => pending.promise } });

    editor.commands.uploadImages([imageFile()]);
    expect(placeholders(editor)).toBe(1);

    // The user rewrote the block while the upload was in flight — there is no
    // longer a spot to parachute the image into.
    editor.commands.setContent('<p>换了内容</p>');
    expect(placeholders(editor)).toBe(0);

    pending.resolve('https://cdn.test/late.png');
    await flush();

    expect(editor.getHTML()).toBe('<p>换了内容</p>');
  });

  it('abandons an upload that lands after the editor is torn down', async () => {
    const succeed = deferred<string>();
    const fail = deferred<string>();
    upload = vi
      .fn<UploadHandler>()
      .mockReturnValueOnce(succeed.promise)
      .mockReturnValueOnce(fail.promise);
    const editor = makeEditor({ upload: { upload }, onUploadError });

    editor.commands.uploadImages([imageFile('a.png'), imageFile('b.png')]);
    editor.destroy();

    succeed.resolve('https://cdn.test/late.png');
    fail.reject(new Error('gone'));
    await expect(flush()).resolves.toBeUndefined();

    // Dispatching into a destroyed view throws; both outcomes must stay quiet.
    expect(onUploadError).not.toHaveBeenCalled();
  });
});
