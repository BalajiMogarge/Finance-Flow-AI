"""Hugging Face Space entrypoint.

Supports both direct Uvicorn execution and Hugging Face Gradio SDK runtime.
"""
try:
    import gradio as gr
    from app.main import app as fastapi_app

    with gr.Blocks(title="Finance Flow AI — Ingestion API") as demo:
        gr.Markdown("# 🚀 Finance Flow AI — Ingestion Backend")
        gr.Markdown(
            "The backend service is operational.\n\n"
            "- **Interactive API Docs (Swagger)**: [/docs](/docs)\n"
            "- **ReDoc API Docs**: [/redoc](/redoc)\n"
            "- **Liveness Check**: [/health](/health)\n"
            "- **Readiness Check**: [/health/ready](/health/ready)\n\n"
            "Connect your frontend by setting `NEXT_PUBLIC_API_URL` to this Space URL."
        )

    # Mount Gradio UI at /ui so all root and /api routes belong exclusively to FastAPI
    app = gr.mount_gradio_app(fastapi_app, demo, path="/ui")
except ImportError:
    from app.main import app  # Fallback to direct FastAPI app

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=7860)
