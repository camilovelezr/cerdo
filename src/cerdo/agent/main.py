import asyncio
import os
from datetime import datetime

import httpx
from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

import logfire

logfire.configure()
logfire.instrument_mcp()
logfire.instrument_pydantic_ai()

playwright = MCPServerStdio(
    "node",
    args=["/app/playwright/dist/index.js"],
)
MODELS = {
    "llama4": "groq:meta-llama/llama-4-scout-17b-16e-instruct",
    "gemini": "google-gla:gemini-2.0-flash",
}

agent = Agent(
    mcp_servers=[playwright],
    system_prompt=(
        "You are an expert AI assistant on helping people download their certificates from Sura "
        "by filling out forms and navigating through websites."
        "You must use the tools provided to you to complete the task."
        "You must return the message 'Listo! Ya descargue los PDFs!' if successful."
    ),
    instrument=True,
)


@agent.tool_plain
async def wait_0_1_seconds():
    """Call this tool when you need to wait 0.1 second."""
    await asyncio.sleep(0.01)


@agent.tool_plain
async def download_file(url: str):
    """Call this tool when you need to download a file from the web.

    Args:
        url: The url of the file to download.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        with open(
            f"/app/Downloads/{datetime.now().strftime('arl_%B_%d_%Y')}.pdf", "wb"
        ) as f:
            f.write(response.content)


CEDULA = os.getenv("CEDULA")
PASSWORD = os.getenv("PASSWORD")

req = f"""
perform the following task:
1. Entrar a la siguiente página: https://sucursal.segurossura.com.co/#/portal/home:
    a. en el primer dropdown seleccionar CEDULA (la primera opcion value=C, no CEDULA DE EXTRANJERIA) (id: ctl00_ContentMain_suraType)
    b. llenar el numero de identificación: {CEDULA} (#suraName)
    c. la contraseña es: {PASSWORD} (input #suraPassword) -> cannot be filled, needs to be clicked!!
    e. Click #session-internet button (Iniciar sesión) (selector: #session-internet)
2. 
    a. Click en el boton con texto 'Otras opciones'
    b. Click en el boton con texto 'documentos y certificados'
3. Click la opción que diga ARL
4. Click la opción que dice Universidad CES 
5. Click on "Continuar" button (ng-component > app-arl > main > app-seleccion-empresa > section > button)
6. Seleccionar la opción: certificado de afiliación
7. Call 'browser_click_and_extract_url' tool to extract the url of the PDF, since clicking the button would open a new tab and you cannot get the url of the new tab.
  buttonText: "Descargar"
  selector: "ng-component > app-descargar-certificados > div > div > form > button"
  waitTime: 20000

  DO NOT CALL 'browser_click'!!!!!
8. Pass the url to the download_file tool and call it (CANNOT MISS THIS STEP)
9. Navigate to 'https://portaleps.epssura.com/ServiciosUnClick/#' AND WAIT FOR 0.1 SECONDS!!
11. Click button with selector: #navbarNav > div > ul > li:nth-child(11) > a
12. Click the button with aria-controls="afiliacionPBS" with selector: #page-content-wrapper > div > div > div > div:nth-child(2) > div > div.col-1 > button
13. Use the 'browser_click_and_download_authenticated' tool with parameters:
    buttonText: 'Generar certificado'
    selector: '#afiliacionPBS > div > div > form > div:nth-child(9) > div > button'
    waitTime: 20000
    
14. If successful, return the message 'Listo! Ya descargue los PDFs!'


For 1.c:
Make sure that the input text of 1.b has been filled in!!
The password presents one of those methods where if user clicks on the input, a keyboard appears (with only numbers).
Therefore, you need to click on the input, and then click on each number in the right order.
You can use 'data-value' to click on the right number.
For example, this is the element for the number 4:
<button role="button" aria-disabled="false" tabindex="-1" class="ui-keyboard-button ui-keyboard-52 ui-buttonkeyset-default" data-value="4" name="52" data-pos="0,1" title=""><span>4</span></button>
So click number {PASSWORD[0]} then click number {PASSWORD[1]},then click number {PASSWORD[2]}, then click number {PASSWORD[3]}, then click with selector: #suraName to click outside the keyboard.

REMEMBER:
- you MAY NOT call 'browser_click' to download the PDF
- you MUST call 'browser_click_and_extract_url' AND THEN CALL 'download_file' to download the PDF
- you MUST return the message 'Listo! Ya descargue los PDFs!' if successful -> NOTHING ELSE

"""


async def main():
    async with agent.run_mcp_servers():
        result = await agent.run(
            req,
            model=MODELS["llama4"],
            model_settings=ModelSettings(
                parallel_tool_calls=False,
                temperature=0.2,
            ),
        )
        if result.output != "Listo! Ya descargue los PDFs!":
            logfire.debug("Failed to download PDFs", result=result.output)
            logfire.info("Retrying with Gemini")
            result = await agent.run(req, model=MODELS["gemini"])
            if result.output != "Listo! Ya descargue los PDFs!":
                logfire.error("Failed to download PDFs", result=result.output)
                logfire.info("Retrying with Llama4")
                result = await agent.run(req, model=MODELS["llama4"])
                if result.output != "Listo! Ya descargue los PDFs!":
                    logfire.error("Failed to download PDFs", result=result.output)
                    logfire.info("Retrying with Gemini")
                    result = await agent.run(req, model=MODELS["gemini"])
        print(result.output)


if __name__ == "__main__":
    asyncio.run(main())
