// build-docx.mjs — render docs/ScrapeLite-Product-Documentation.md to a Word
// .docx, embedding the screenshots and using real heading styles (so Word's
// navigation pane + table of contents work).
//
//   NODE_PATH unused (ESM). The docx lib is required by absolute path so the
//   project's own dependencies stay untouched:
//     node docs/build-docx.mjs        (expects docx installed at DOCX_LIB)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_MD = join(ROOT, "docs/ScrapeLite-Product-Documentation.md");
const OUT = join(ROOT, "docs/ScrapeLite-Product-Documentation.docx");
const DOCX_LIB = process.env.DOCX_LIB || "/tmp/docxlib/node_modules/docx";

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink,
  Table, TableRow, TableCell, ImageRun, Header, Footer,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, TableOfContents,
} = require(DOCX_LIB);

const CONTENT_W = 9360; // US Letter, 1" margins
const ACCENT = "4F46E5";
const CODE_BG = "F1F3F9";
const HEAD_BG = "EEF1F8";
const BORDER = "D9DEE8";

// ── PNG dimensions (read IHDR) ───────────────────────────────────────────────
function pngSize(buf) {
  // width @ byte 16, height @ byte 20 (big-endian)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ── Inline markdown → array of docx runs ─────────────────────────────────────
function parseInline(str, ctx = {}) {
  const runs = [];
  let s = str;
  const finders = [
    { type: "code", re: /`([^`]+)`/ },
    { type: "img", re: /!\[([^\]]*)\]\(([^)]+)\)/ },
    { type: "link", re: /\[([^\]]+)\]\(([^)]+)\)/ },
    { type: "bold", re: /\*\*([^*]+?)\*\*/ },
    { type: "italic", re: /(^|[^*])\*([^*\n]+?)\*(?!\*)/ },
  ];
  while (s.length) {
    let best = null;
    for (const f of finders) {
      const m = f.re.exec(s);
      if (m && (!best || m.index < best.m.index)) best = { f, m };
    }
    if (!best) {
      runs.push(mkRun(s, ctx));
      break;
    }
    const { f, m } = best;
    let idx = m.index;
    let pre = s.slice(0, idx);
    // italic regex captures a leading non-* char in group 1
    if (f.type === "italic" && m[1]) pre += m[1];
    if (pre) runs.push(mkRun(pre, ctx));
    if (f.type === "code") {
      runs.push(mkRun(m[1], { ...ctx, code: true }));
    } else if (f.type === "img") {
      runs.push(mkRun(m[1] || m[2], { ...ctx })); // inline images: show alt text
    } else if (f.type === "link") {
      runs.push(...parseInline(m[1], { ...ctx, link: m[2] }));
    } else if (f.type === "bold") {
      runs.push(...parseInline(m[1], { ...ctx, bold: true }));
    } else if (f.type === "italic") {
      runs.push(...parseInline(m[2], { ...ctx, italics: true }));
    }
    s = s.slice(idx + m[0].length);
  }
  return runs.filter(Boolean);
}

function mkRun(text, ctx) {
  if (!text) return null;
  const opts = { text };
  if (ctx.bold) opts.bold = true;
  if (ctx.italics) opts.italics = true;
  if (ctx.code) {
    opts.font = "Consolas";
    opts.size = 19;
    opts.shading = { type: ShadingType.CLEAR, fill: "E9ECF5", color: "auto" };
    opts.color = "9333EA";
  }
  if (ctx.link) {
    opts.style = "Hyperlink";
    return new ExternalHyperlink({ link: ctx.link, children: [new TextRun(opts)] });
  }
  return new TextRun(opts);
}

// ── Block-level parse → docx elements ────────────────────────────────────────
const olConfigs = [];
let olCount = 0;

function isTableSep(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-") && line.includes("|");
}
function splitRow(line) {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split(/\s*\|\s*/).map((c) => c.trim());
}

function headingFor(mdLevel, text) {
  // md '#'→Title-ish H1, '##'→H1, '###'→H2 … (shift down one for clean TOC)
  const map = {
    1: HeadingLevel.TITLE,
    2: HeadingLevel.HEADING_1,
    3: HeadingLevel.HEADING_2,
    4: HeadingLevel.HEADING_3,
    5: HeadingLevel.HEADING_4,
    6: HeadingLevel.HEADING_5,
  };
  return new Paragraph({ heading: map[mdLevel] || HeadingLevel.HEADING_5, children: parseInline(text) });
}

function codeBlock(lines) {
  const out = [];
  lines.forEach((ln, i) => {
    out.push(
      new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: CODE_BG, color: "auto" },
        spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0, line: 230 },
        indent: { left: 120, right: 120 },
        children: [new TextRun({ text: ln.length ? ln : " ", font: "Consolas", size: 17, color: "1F2937" })],
      }),
    );
  });
  return out;
}

function tableBlock(header, rows) {
  const ncols = header.length;
  const base = Math.floor(CONTENT_W / ncols);
  const widths = Array.from({ length: ncols }, (_, i) => (i === ncols - 1 ? CONTENT_W - base * (ncols - 1) : base));
  const border = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headRow = new TableRow({
    tableHeader: true,
    children: header.map((h, i) =>
      new TableCell({
        borders,
        width: { size: widths[i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: HEAD_BG, color: "auto" },
        margins: { top: 60, bottom: 60, left: 110, right: 110 },
        children: [new Paragraph({ spacing: { after: 0 }, children: parseInline(h, { bold: true }) })],
      }),
    ),
  });
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: header.map(
          (_, i) =>
            new TableCell({
              borders,
              width: { size: widths[i], type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 110, right: 110 },
              children: [new Paragraph({ spacing: { after: 0 }, children: parseInline(r[i] || "") })],
            }),
        ),
      }),
  );
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headRow, ...bodyRows],
  });
}

function imageBlock(alt, src) {
  const abs = resolve(dirname(SRC_MD), src);
  let data;
  try {
    data = readFileSync(abs);
  } catch {
    return new Paragraph({ children: [new TextRun({ text: `[image: ${alt}]`, italics: true, color: "888888" })] });
  }
  const { w, h } = pngSize(data);
  const dispW = Math.min(600, w);
  const dispH = Math.round(dispW * (h / w));
  const out = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 40 },
      children: [
        new ImageRun({
          type: "png",
          data,
          transformation: { width: dispW, height: dispH },
          altText: { title: alt || "screenshot", description: alt || "ScrapeLite screenshot", name: alt || "screenshot" },
        }),
      ],
    }),
  ];
  if (alt) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: alt, italics: true, size: 18, color: "8A93A5" })],
      }),
    );
  }
  return out;
}

function renderListBlock(lines) {
  // map distinct indents → levels
  const parsed = lines.map((ln) => {
    const m = ln.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    return { indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] };
  });
  const indents = [...new Set(parsed.map((p) => p.indent))].sort((a, b) => a - b);
  const levelOf = (ind) => Math.min(2, indents.indexOf(ind));
  const hasOrdered = parsed.some((p) => p.ordered);
  let olRef = null;
  if (hasOrdered) {
    olCount++;
    olRef = `ol${olCount}`;
    olConfigs.push({
      reference: olRef,
      levels: [0, 1, 2].map((lvl) => ({
        level: lvl,
        format: LevelFormat.DECIMAL,
        text: `%${lvl + 1}.`,
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720 + lvl * 360, hanging: 360 } } },
      })),
    });
  }
  return parsed.map((p) => {
    const level = levelOf(p.indent);
    const ref = p.ordered ? olRef : "bullets";
    return new Paragraph({
      numbering: { reference: ref, level },
      spacing: { after: 40 },
      children: parseInline(p.text),
    });
  });
}

function mdToDocx(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join(" ").trim();
    if (text) {
      const img = text.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (img) out.push(...imageBlock(img[1], img[2]));
      else out.push(new Paragraph({ spacing: { after: 120 }, children: parseInline(text) }));
    }
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(...codeBlock(buf));
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]) && line.trim().startsWith("|")) {
      flush();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(tableBlock(header, rows));
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      out.push(headingFor(h[1].length, h[2]));
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flush();
      out.push(
        new Paragraph({
          spacing: { before: 80, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 1 } },
          children: [],
        }),
      );
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const parts = buf.join("\n").split(/\n\s*\n/);
      for (const p of parts) {
        out.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: "F4F2FE", color: "auto" },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
            indent: { left: 240 },
            spacing: { before: 40, after: 120, line: 276 },
            children: parseInline(p.replace(/\n/g, " ")),
          }),
        );
      }
      continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      flush();
      const buf = [];
      while (
        i < lines.length &&
        (/^(\s*)([-*]|\d+\.)\s+/.test(lines[i]) ||
          (lines[i].trim() === "" && /^(\s*)([-*]|\d+\.)\s+/.test(lines[i + 1] || "")))
      ) {
        if (lines[i].trim() !== "") buf.push(lines[i]);
        i++;
      }
      out.push(...renderListBlock(buf));
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

// ── Build the document ───────────────────────────────────────────────────────
const md = readFileSync(SRC_MD, "utf8");
const body = mdToDocx(md);

// Insert a Word TOC right after the title (first element is the TITLE heading).
const titleIdx = 0;
const toc = [
  new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: "Contents", bold: true, size: 26 })] }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
  new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 1 } }, children: [] }),
];
const children = [body[titleIdx], ...toc, ...body.slice(titleIdx + 1)];

const doc = new Document({
  creator: "ScrapeLite",
  title: "ScrapeLite — Complete Product Documentation",
  description: "ScrapeLite v2.0 product documentation",
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } }, // ~10.5pt
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 48, bold: true, font: "Arial", color: "11192A" },
        paragraph: { spacing: { before: 60, after: 200 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "11192A" },
        paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "1F2740" },
        paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1, keepNext: true } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 23, bold: true, font: "Arial", color: "2A3350" },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2, keepNext: true } },
      { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 21, bold: true, font: "Arial", color: "39435E" },
        paragraph: { spacing: { before: 120, after: 60 }, outlineLevel: 3, keepNext: true } },
      { id: "Heading5", name: "Heading 5", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 21, bold: true, italics: true, font: "Arial", color: "5A6577" },
        paragraph: { spacing: { before: 100, after: 40 }, outlineLevel: 4 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [0, 1, 2].map((lvl) => ({
          level: lvl,
          format: LevelFormat.BULLET,
          text: ["•", "◦", "▪"][lvl],
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540 + lvl * 360, hanging: 280 } } },
        })) },
      ...olConfigs,
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 } },
              children: [new TextRun({ text: "ScrapeLite · Product Documentation (v2.0)", size: 16, color: "97A0B0" })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Page ", size: 16, color: "97A0B0" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "97A0B0" }),
                new TextRun({ text: " of ", size: 16, color: "97A0B0" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "97A0B0" }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${(buf.length / 1024).toFixed(0)} KB), ${children.length} top-level blocks.`);
});
