from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import os

PDF_DIR = "generated_pdfs"
os.makedirs(PDF_DIR, exist_ok=True)

def text_to_pdf(text, filename=None):
    """
    Converts given text into a formatted PDF document.
    Returns the path of the saved file.
    """
    if not filename:
        filename = "LegalSathi_Document.pdf"

    file_path = os.path.join(PDF_DIR, filename)
    c = canvas.Canvas(file_path, pagesize=A4)
    width, height = A4

    # Title header
    c.setFont("Helvetica-Bold", 14)
    c.drawString(80, height - 80, "⚖️ LegalSathi - AI Generated Document")

    # Document text
    c.setFont("Helvetica", 11)
    y = height - 120
    for line in text.splitlines():
        if y < 50:
            c.showPage()
            c.setFont("Helvetica", 11)
            y = height - 100
        c.drawString(60, y, line)
        y -= 15

    c.save()
    return file_path
