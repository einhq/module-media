/**
 * A document's renditions: every picture role of kind `document` cut from its first page in one
 * `document.renditions` call, whatever the page's size, and for a Word, OpenDocument or RTF file the
 * PDF the viewer shows, made with them or alone. The first page's size in points becomes the file's
 * `width` and `height`, the marker waits for the PDF, and a document EMS cannot open is marked
 * `undecodable` until a forced run reads it.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import { RENDITIONS_FOR_ATTR } from '@media/rendition-marker';

/** Where the files under test live: any folder that wants renditions. */
const LIBRARY = '/library';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fileRoot = await Deno.makeTempDir({ prefix: 'ein-document-renditions-' });
const testCtx = createTestContext({ modules: ['media'], fileRoot });

type Report = { created: string[]; failed: number; marked: boolean };
type Body = { file: { mimetype?: string }; targets: { output: { path: string }; box: { width: number } }[]; pdf?: { output: { path: string } } };

Deno.test({
  name: 'generate-derivatives makes a document its first page and its PDF',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();

  /** What the last call asked for: the boxes, and whether it asked for the PDF. */
  let asked: { boxes: number[]; pdf: boolean; mimetype?: string } | undefined;
  let undecodable = false;
  const stub = startStubEms({
    ops: {
      'document.renditions': async (raw) => {
        const body = raw as unknown as Body;
        asked = { boxes: body.targets.map((target) => target.box.width), pdf: body.pdf !== undefined, mimetype: body.file.mimetype };
        if (undecodable) return { error: { code: 'undecodable', message: 'LibreOffice could not read the document', permanent: true }, status: 422 };
        for (const target of body.targets) await Deno.writeTextFile(target.output.path, 'avif-bytes');
        if (body.pdf) await Deno.writeTextFile(body.pdf.output.path, '%PDF-1.7');
        return {
          result: {
            frame: { width: 1131, height: 1600 },
            targets: body.targets.map(() => ({ path: '', width: 1, height: 1, bytes: 10 })),
            pages: 3,
            page: { width: 595.28, height: 841.89 },
            ...(body.pdf ? { pdf: { path: body.pdf.output.path, bytes: 8 } } : {}),
          },
        };
      },
    },
  });
  const env = `CFG_EMS_URL=${stub.url}`;

  const makeFile = async (name: string, attrs: Record<string, unknown>): Promise<string> => {
    const path = `${LIBRARY}/d/${name}`;
    await client.exec(`mkfile ${path}`);
    await vfs.update(ADMIN_ACCESS, path, { attrs: { size: 100, ...attrs } });
    return path;
  };
  const names = async (path: string) => (await vfs.children(ADMIN_ACCESS, `${path}/thumbnails`)).map((c) => c.name).sort();
  const attrsOf = async (path: string) => (await vfs.get(ADMIN_ACCESS, path)).attrs;

  try {
    await client.exec(`mkdir -p ${LIBRARY}/d`);

    await t.step('a PDF gets every picture of its kind and no PDF, and its page size', async () => {
      const pdf = await makeFile('letter.pdf', { mimetype: 'application/pdf' });
      const report = await client.execJson<Report>(`${env} JSON_OUTPUT=1 generate-derivatives ${pdf} --only still`);
      assertEquals(report.failed, 0);
      assertEquals(asked, { boxes: [320, 512, 800, 1600], pdf: false, mimetype: 'application/pdf' });
      assertEquals(await names(pdf), ['1600x1600.avif', '320x320.avif', '512x512.avif', '800x800.avif']);
      const attrs = await attrsOf(pdf);
      assertEquals([attrs.width, attrs.height], [595, 842]);
      assertEquals(report.marked, true);
      assertEquals(typeof attrs[RENDITIONS_FOR_ATTR], 'string');
    });

    await t.step('a Word file gets its PDF in the same call, and alone when only it is missing', async () => {
      const docx = await makeFile('brev.docx', { mimetype: DOCX });
      const report = await client.execJson<Report>(`${env} JSON_OUTPUT=1 generate-derivatives ${docx} --only still`);
      assertEquals(report.failed, 0);
      assertEquals(asked, { boxes: [320, 512, 800, 1600], pdf: true, mimetype: DOCX });
      assertEquals(await names(docx), ['1600x1600.avif', '320x320.avif', '512x512.avif', '800x800.avif', 'view.pdf']);
      assertEquals(report.marked, true);

      await vfs.unlink(ADMIN_ACCESS, `${docx}/thumbnails/view.pdf`, `${docx}/thumbnails`);
      asked = undefined;
      const again = await client.execJson<Report>(`${env} JSON_OUTPUT=1 generate-derivatives ${docx}`);
      assertEquals(again.failed, 0);
      assertEquals(asked, { boxes: [], pdf: true, mimetype: DOCX });
      assertEquals(again.created, [`${docx}/thumbnails/view.pdf`]);
    });

    await t.step('a document EMS cannot open is marked undecodable, until a forced run reads it', async () => {
      const broken = await makeFile('broken.odt', { mimetype: 'application/vnd.oasis.opendocument.text' });
      undecodable = true;
      const report = await client.execJson<Report>(`${env} JSON_OUTPUT=1 generate-derivatives ${broken}`).catch(() => undefined);
      assertEquals(report?.failed ?? 1, 1);
      assertEquals((await attrsOf(broken)).undecodable, 'LibreOffice could not read the document');

      asked = undefined;
      await client.exec(`${env} generate-derivatives ${broken}`);
      assertEquals(asked, undefined);

      undecodable = false;
      const forced = await client.execJson<Report>(`${env} JSON_OUTPUT=1 generate-derivatives -f ${broken}`);
      assertEquals(forced.failed, 0);
      assertEquals((await attrsOf(broken)).undecodable, undefined);
    });
  } finally {
    await stub.close();
    await testCtx.teardown();
    await Deno.remove(fileRoot, { recursive: true }).catch(() => {});
  }
});
