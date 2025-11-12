from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import os

def text_to_pdf(text, filename="LegalSathi_Document.pdf"):
    os.makedirs("generated_pdfs", exist_ok=True)
    pdf_path = os.path.join("generated_pdfs", filename)

    c = canvas.Canvas(pdf_path, pagesize=A4)
    width, height = A4
    margin = 50
    y = height - margin
    line_height = 14

    # Very simple word-wrap
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        line = ""
        for w in words:
            test_line = (line + " " + w).strip()
            if c.stringWidth(test_line, "Helvetica", 11) < (width - 2*margin):
                line = test_line
            else:
                c.setFont("Helvetica", 11)
                c.drawString(margin, y, line)
                y -= line_height
                line = w
                if y < margin:
                    c.showPage()
                    y = height - margin
        if line:
            c.setFont("Helvetica", 11)
            c.drawString(margin, y, line)
            y -= line_height
        # blank line between paragraphs
        y -= line_height/2
        if y < margin:
            c.showPage()
            y = height - margin

    c.save()
    return pdf_path
