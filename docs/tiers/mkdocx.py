#!/usr/bin/env python3
"""Build a real .docx (OOXML zip) without any third-party library.

LibreOffice in this container cannot load any input format, so the document is
assembled directly. Only the parts Word actually requires are written.
"""
import zipfile, html, os, sys

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def esc(t):
    return html.escape(t, quote=False)


def runs(text, bold=False, italic=False, mono=False, color=None, size=None):
    """One or more runs. **bold**, *italic* and `code` are honoured inline."""
    out = []
    buf = ''
    i = 0
    while i < len(text):
        for mark, key in (('**', 'b'), ('`', 'c'), ('*', 'i')):
            if text.startswith(mark, i):
                end = text.find(mark, i + len(mark))
                if end != -1:
                    if buf:
                        out.append(_run(buf, bold, italic, mono, color, size)); buf = ''
                    inner = text[i + len(mark):end]
                    out.append(_run(inner,
                                    bold or key == 'b',
                                    italic or key == 'i',
                                    mono or key == 'c',
                                    color, size))
                    i = end + len(mark)
                    break
        else:
            buf += text[i]; i += 1
            continue
    if buf:
        out.append(_run(buf, bold, italic, mono, color, size))
    return ''.join(out) or _run('', bold, italic, mono, color, size)


def _run(t, bold, italic, mono, color, size):
    pr = ''
    if mono:
        pr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
    if bold:
        pr += '<w:b/>'
    if italic:
        pr += '<w:i/>'
    if color:
        pr += f'<w:color w:val="{color}"/>'
    if size:
        pr += f'<w:sz w:val="{size*2}"/>'
    pr = f'<w:rPr>{pr}</w:rPr>' if pr else ''
    return (f'<w:r>{pr}<w:t xml:space="preserve">{esc(t)}</w:t></w:r>')


def para(text='', style=None, space_after=120, **kw):
    ppr = ''
    if style:
        ppr += f'<w:pStyle w:val="{style}"/>'
    ppr += f'<w:spacing w:after="{space_after}"/>'
    return f'<w:p><w:pPr>{ppr}</w:pPr>{runs(text, **kw)}</w:p>'


def cell(text, width, shade=None, bold=False, align=None, italic=False, size=None):
    tcpr = f'<w:tcW w:w="{width}" w:type="dxa"/>'
    if shade:
        tcpr += f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>'
    tcpr += '<w:vAlign w:val="top"/>'
    # CT_PPr is a sequence: spacing precedes jc, and rPr is last. Word refuses
    # to open a document whose elements are out of schema order.
    jc = f'<w:jc w:val="{align}"/>' if align else ''
    body = (f'<w:p><w:pPr><w:spacing w:after="20"/>{jc}'
            f'<w:rPr><w:sz w:val="18"/></w:rPr></w:pPr>'
            f'{runs(text, bold=bold, italic=italic, size=size or 9)}</w:p>')
    return f'<w:tc><w:tcPr>{tcpr}</w:tcPr>{body}</w:tc>'


def table(rows, widths):
    """rows: list of (cells, opts). cells may be (text, colspan)."""
    borders = ''.join(
        f'<w:{e} w:val="single" w:sz="6" w:space="0" w:color="999999"/>'
        for e in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    out = [f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>'
           f'<w:tblBorders>{borders}</w:tblBorders>'
           f'<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>']
    for cells, opts in rows:
        shade = opts.get('shade')
        bold = opts.get('bold', False)
        tcs = []
        for idx, c in enumerate(cells):
            span = 1
            text = c
            if isinstance(c, tuple):
                text, span = c
            w = sum(widths[idx:idx + span]) if span > 1 else widths[idx] if idx < len(widths) else 1000
            al = 'center' if idx in opts.get('center', ()) else None
            tc = cell(text, w, shade=opts.get('cellshade', {}).get(idx, shade),
                      bold=bold, align=al, italic=opts.get('italic', False))
            if span > 1:
                # gridSpan follows tcW in CT_TcPr, never precedes it.
                tc = tc.replace('w:type="dxa"/>',
                                f'w:type="dxa"/><w:gridSpan w:val="{span}"/>', 1)
            tcs.append(tc)
        trpr = '<w:trPr><w:tblHeader/></w:trPr>' if opts.get('header') else ''
        out.append(f'<w:tr>{trpr}{"".join(tcs)}</w:tr>')
    out.append('</w:tbl>')
    out.append('<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>')
    return ''.join(out)


STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="%s">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
<w:pPr><w:spacing w:after="60"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="999999"/></w:pBdr>
<w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
<w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Sub"><w:name w:val="Sub"/>
<w:rPr><w:color w:val="555555"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/>
<w:rPr><w:i/><w:color w:val="444444"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>
<w:pPr><w:ind w:left="360"/></w:pPr></w:style>
</w:styles>''' % W

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

DOC_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''


def build(body_xml, path):
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           f'<w:document xmlns:w="{W}"><w:body>{body_xml}'
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
           '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"'
           ' w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
           '</w:body></w:document>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('_rels/.rels', RELS)
        z.writestr('word/_rels/document.xml.rels', DOC_RELS)
        z.writestr('word/styles.xml', STYLES)
        z.writestr('word/document.xml', doc)
    return path
