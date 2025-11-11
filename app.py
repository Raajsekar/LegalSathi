import streamlit as st
from utils import ask_ai, generate_contract

st.set_page_config(page_title="LegalSathi - AI Legal Assistant 🇮🇳", page_icon="⚖️", layout="centered")

st.title("⚖️ LegalSathi - Your AI Legal Assistant")
st.write("Ask LegalSathi to **summarize**, **draft**, **generate contracts**, or **advise** on legal documents related to India 🇮🇳")

# Sidebar navigation
st.sidebar.header("Choose Feature")
feature = st.sidebar.radio(
    "Select a feature:",
    ["General Q&A", "Legal Drafting", "Summarize Document", "Get Advice", "Contract Generator"]
)

# ============ Feature 1: General Q&A / Drafting / Summary / Advice ============
if feature in ["General Q&A", "Legal Drafting", "Summarize Document", "Get Advice"]:
    st.header(f"💬 {feature}")
    user_input = st.text_area("Enter your question or legal text:")

    if st.button("Ask LegalSathi"):
        if not user_input.strip():
            st.warning("Please enter some text to continue.")
        else:
            with st.spinner("Thinking... 🤔"):
                try:
                    if feature == "General Q&A":
                        response = ask_ai(user_input, "general")
                    elif feature == "Legal Drafting":
                        response = ask_ai(user_input, "legal_draft")
                    elif feature == "Summarize Document":
                        response = ask_ai(user_input, "summary")
                    elif feature == "Get Advice":
                        response = ask_ai(user_input, "advice")
                    else:
                        response = ask_ai(user_input)

                    st.success("✅ Response:")
                    st.write(response)

                except Exception as e:
                    st.error(f"An error occurred: {str(e)}")


# ============ Feature 2: Contract Generator ============
elif feature == "Contract Generator":
    st.header("🧾 Contract Generator")

    contract_type = st.selectbox(
        "Select contract type",
        ["Freelancer Agreement", "NDA", "Rent Agreement", "Employment Offer", "Partnership Deed"]
    )

    details = st.text_area("Enter details (names, duration, payment terms, etc.)")

    if st.button("📝 Generate Contract"):
        if details.strip():
            with st.spinner("Drafting your contract..."):
                try:
                    contract_text = generate_contract(contract_type, details)
                    st.success("✅ Contract Generated Successfully!")
                    st.write(contract_text)

                    # Save as docx file
                    from docx import Document
                    doc = Document()
                    doc.add_paragraph(contract_text)
                    doc.save("generated_contract.docx")

                    with open("generated_contract.docx", "rb") as file:
                        st.download_button(
                            "⬇️ Download Contract",
                            file,
                            file_name=f"LegalSathi_{contract_type.replace(' ', '_')}.docx"
                        )
                except Exception as e:
                    st.error(f"Error: {str(e)}")
        else:
            st.warning("Please enter contract details before generating.")


st.markdown("---")
st.markdown("💡 *LegalSathi provides AI-generated drafts for educational purposes. Always review documents with a legal expert before use.*")
