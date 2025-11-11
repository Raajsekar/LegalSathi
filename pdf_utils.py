from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from datetime import datetime

def text_to_pdf(text, filename="LegalSathi_Document.pdf"):
    pdf_path = f"generated_pdfs/{filename}"
    
    # Ensure folder exists
    import os
    os.makedirs("generated_pdfs", exist_ok=True)

    c = canvas.Canvas(pdf_path, pagesize=A4)
    width, height = A4
    y = height - 50

    for line in text.split("\n"):
        if y < 50:  # New page when full
            c.showPage()
            y = height - 50
        c.drawString(50, y, line.strip())
        y -= 15

    c.save()
    return pdf_path
