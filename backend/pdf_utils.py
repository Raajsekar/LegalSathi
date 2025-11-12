# backend/pdf_utils.py
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import os
import textwrap

def text_to_pdf(text, filename="LegalSathi_Document.pdf"):
    os.makedirs("generated_pdfs", exist_ok=True)
    pdf_path = os.path.join("generated_pdfs", filename)

    c = canvas.Canvas(pdf_path, pagesize=A4)
    width, height = A4
    margin = 50
    y = height - margin
    line_height = 14
    max_width = width - 2 * margin
    font_name = "Helvetica"
    font_size = 11
    c.setFont(font_name, font_size)

    # Use simple textwrap to respect canvas width
    # estimate the number of characters per line (conservative)
    approx_char_per_line = int(max_width / (font_size * 0.5))
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            y -= line_height
            if y < margin:
                c.showPage()
                c.setFont(font_name, font_size)
                y = height - margin
            continue

        wrapped = textwrap.wrap(paragraph, width=approx_char_per_line)
        for line in wrapped:
            if y < margin:
                c.showPage()
                c.setFont(font_name, font_size)
                y = height - margin
            c.drawString(margin, y, line)
            y -= line_height

    c.save()
    return pdf_path
