#!/usr/bin/env node

import yargs from "yargs/yargs";
import { hideBin } from 'yargs/helpers'
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import playwright, { Browser, Page } from "playwright";

enum ToolName {
  BrowserNavigate = "browser_navigate",
  BrowserScreenshot = "browser_screenshot",
  BrowserClick = "browser_click",
  BrowserClickText = "browser_click_text",
  BrowserFill = "browser_fill",
  BrowserSelect = "browser_select",
  BrowserSelectText = "browser_select_text",
  BrowserHover = "browser_hover",
  BrowserHoverText = "browser_hover_text",
  BrowserEvaluate = "browser_evaluate",
  BrowserClickAndCapture = "browser_click_and_capture",
  BrowserDownloadPDF = "browser_download_pdf",
  BrowserForceDownload = "browser_force_download",
  BrowserAuthenticatedDownload = "browser_authenticated_download",
  BrowserCaptureRequest = "browser_capture_request",
  BrowserInterceptTabs = "browser_intercept_tabs",
  BrowserClickAndExtractUrl = "browser_click_and_extract_url",
  BrowserClickAndDownloadAuthenticated = "browser_click_and_download_authenticated" // New tool for authenticated direct download
}

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
  {
    name: ToolName.BrowserNavigate,
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: ToolName.BrowserScreenshot,
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot" },
        selector: { type: "string", description: "CSS selector for element to screenshot" },
        fullPage: { type: "boolean", description: "Take a full page screenshot (default: false)", default: false },
      },
      required: ["name"],
    },
  },
  {
    name: ToolName.BrowserClick,
    description: "Click an element on the page using CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: ToolName.BrowserClickText,
    description: "Click an element on the page by its text content",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text content of the element to click" },
      },
      required: ["text"],
    },
  },
  {
    name: ToolName.BrowserFill,
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for input field" },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: ToolName.BrowserSelect,
    description: "Select an element on the page with Select tag using CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to select" },
        value: { type: "string", description: "Value to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: ToolName.BrowserSelectText,
    description: "Select an element on the page with Select tag by its text content",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text content of the element to select" },
        value: { type: "string", description: "Value to select" },
      },
      required: ["text", "value"],
    },
  },
  {
    name: ToolName.BrowserHover,
    description: "Hover an element on the page using CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to hover" },
      },
      required: ["selector"],
    },
  },
  {
    name: ToolName.BrowserHoverText,
    description: "Hover an element on the page by its text content",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text content of the element to hover" },
      },
      required: ["text"],
    },
  },
  {
    name: ToolName.BrowserEvaluate,
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["script"],
    },
  },
  {
    name: ToolName.BrowserClickAndCapture,
    description: "Clicks a button by its text, waits for redirection, and returns the new URL",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button to click"
        },
        waitTime: {
          type: "number",
          description: "Time to wait in milliseconds (default: 10000 = 10 seconds)"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button')"
        }
      },
      required: ["buttonText"],
    },
  },
  {
    name: ToolName.BrowserDownloadPDF,
    description: "Clicks a button that triggers a PDF download in a new tab, captures the PDF and saves it",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button to click"
        },
        fileName: {
          type: "string",
          description: "Name to save the PDF as"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a')"
        },
        waitTime: {
          type: "number",
          description: "Time to wait in milliseconds (default: 15000 = 15 seconds)"
        }
      },
      required: ["buttonText", "fileName"],
    },
  },
  {
    name: ToolName.BrowserForceDownload,
    description: "Forces download of a file by intercepting network requests triggered by clicking a button",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button that triggers the download"
        },
        fileName: {
          type: "string",
          description: "Name to save the file as"
        },
        fileTypes: {
          type: "string",
          description: "Comma-separated list of file extensions to intercept (default: 'pdf,doc,docx,xls,xlsx,ppt,pptx,zip')"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a')"
        },
        waitTime: {
          type: "number",
          description: "Time to wait for download in milliseconds (default: 30000 = 30 seconds)"
        }
      },
      required: ["buttonText", "fileName"],
    },
  },
  {
    name: ToolName.BrowserAuthenticatedDownload,
    description: "Downloads a file by triggering download button and preserving authentication. Uses the same authenticated session.",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button that triggers the download"
        },
        fileName: {
          type: "string",
          description: "Name to save the file as"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a')"
        },
        waitTime: {
          type: "number",
          description: "Maximum time to wait for download in milliseconds (default: 30000 = 30 seconds)"
        },
        closeNewTabs: {
          type: "boolean",
          description: "Whether to close new tabs that might open during the download (default: true)"
        }
      },
      required: ["buttonText", "fileName"],
    },
  },
  {
    name: ToolName.BrowserCaptureRequest,
    description: "Clicks a button and captures network traffic to download PDF files without opening new windows",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button that triggers the PDF request"
        },
        fileName: {
          type: "string",
          description: "Name to save the PDF as"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a')"
        },
        waitTime: {
          type: "number",
          description: "Time to wait for network requests in milliseconds (default: 15000 = 15 seconds)"
        },
        blockWindowOpen: {
          type: "boolean",
          description: "Whether to block window.open calls (default: true)"
        }
      },
      required: ["buttonText", "fileName"],
    },
  },
  // Tab interception tool
  {
    name: ToolName.BrowserInterceptTabs,
    description: "Intercepts JavaScript that tries to open PDF in new tabs without actually opening them",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button that triggers the PDF tab"
        },
        fileName: {
          type: "string",
          description: "Name to save the PDF as (used if direct download possible)"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a')"
        },
        waitTime: {
          type: "number",
          description: "Time to wait for script execution in milliseconds (default: 5000 = 5 seconds)"
        }
      },
      required: ["buttonText", "fileName"],
    },
  },
  // New URL extraction tool
  {
    name: ToolName.BrowserClickAndExtractUrl,
    description: "Intercepts JavaScript triggered by a button click to extract the URL (e.g., for PDF tabs) without opening the tab.",
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button that triggers the URL action"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a')"
        },
        waitTime: {
          type: "number",
          description: "Time to wait for script execution in milliseconds (default: 5000 = 5 seconds)"
        }
      },
      required: ["buttonText"],
    },
  },
  // New authenticated direct download tool
  {
    name: ToolName.BrowserClickAndDownloadAuthenticated,
    description: "Clicks a button, captures the resulting file download, and saves it directly to the Downloads folder with an automatic filename based on the current date (e.g., eps_Month_Day_Year.ext).", // Updated description
    inputSchema: {
      type: "object",
      properties: {
        buttonText: {
          type: "string",
          description: "Text content of the button that triggers the download"
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to narrow down button search (default: 'button, a, input[type=button], input[type=submit]')"
        },
        waitTime: {
          type: "number",
          description: "Maximum time to wait for download event in milliseconds (default: 30000 = 30 seconds)"
        }
      },
      required: ["buttonText"], // fileName removed from required
    },
  },
];

// Global state
let browser: Browser | undefined;
let page: Page | undefined;
const consoleLogs: string[] = [];
const screenshots = new Map<string, string>();

async function ensureBrowser() {
  if (!browser) {
    browser = await playwright.firefox.launch({ headless: true }); // Set headless to true
  }

  if (!page) {
    page = await browser.newPage();
  }

  page.on("console", (msg) => {
    const logEntry = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(logEntry);
    server.notification({
      method: "notifications/resources/updated",
      params: { uri: "console://logs" },
    });
  });
  return page!;
}

async function handleToolCall(name: ToolName, args: any): Promise<CallToolResult> {
  const page = await ensureBrowser();

  switch (name) {
    case ToolName.BrowserNavigate:
      await page.goto(args.url);
      return {
        content: [{
          type: "text",
          text: `Navigated to ${args.url}`,
        }],
        isError: false,
      };

    case ToolName.BrowserScreenshot: {
      const fullPage = (args.fullPage === 'true');

      const screenshot = await (args.selector ?
        page.locator(args.selector).screenshot() :
        page.screenshot({ fullPage }));
      const base64Screenshot = screenshot.toString('base64');

      if (!base64Screenshot) {
        return {
          content: [{
            type: "text",
            text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed",
          }],
          isError: true,
        };
      }

      screenshots.set(args.name, base64Screenshot);
      server.notification({
        method: "notifications/resources/list_changed",
      });

      return {
        content: [
          {
            type: "text",
            text: `Screenshot '${args.name}' taken`,
          } as TextContent,
          {
            type: "image",
            data: base64Screenshot,
            mimeType: "image/png",
          } as ImageContent,
        ],
        isError: false,
      };
    }

    case ToolName.BrowserClick:
      try {
        await page.locator(args.selector).click();
        return {
          content: [{
            type: "text",
            text: `Clicked: ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.locator(args.selector).first().click();
            return {
              content: [{
                type: "text",
                text: `Clicked: ${args.selector}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed (twice) to click ${args.selector}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }

        return {
          content: [{
            type: "text",
            text: `Failed to click ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserClickText:
      try {
        await page.getByText(args.text).click();
        return {
          content: [{
            type: "text",
            text: `Clicked element with text: ${args.text}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.getByText(args.text).first().click();
            return {
              content: [{
                type: "text",
                text: `Clicked element with text: ${args.text}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed (twice) to click element with text ${args.text}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `Failed to click element with text ${args.text}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserFill:
      try {
        await page.locator(args.selector).pressSequentially(args.value, { delay: 100 });
        return {
          content: [{
            type: "text",
            text: `Filled ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.locator(args.selector).first().pressSequentially(args.value, { delay: 100 });
            return {
              content: [{
                type: "text",
                text: `Filled ${args.selector} with: ${args.value}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed (twice) to fill ${args.selector}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `Failed to fill ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserSelect:
      try {
        await page.locator(args.selector).selectOption(args.value);
        return {
          content: [{
            type: "text",
            text: `Selected ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.locator(args.selector).first().selectOption(args.value);
            return {
              content: [{
                type: "text",
                text: `Selected ${args.selector} with: ${args.value}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed (twice) to select ${args.selector}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `Failed to select ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserSelectText:
      try {
        await page.getByText(args.text).selectOption(args.value);
        return {
          content: [{
            type: "text",
            text: `Selected element with text ${args.text} with value: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.getByText(args.text).first().selectOption(args.value);
            return {
              content: [{
                type: "text",
                text: `Selected element with text ${args.text} with value: ${args.value}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed (twice) to select element with text ${args.text}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `Failed to select element with text ${args.text}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserHover:
      try {
        await page.locator(args.selector).hover();
        return {
          content: [{
            type: "text",
            text: `Hovered ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.locator(args.selector).first().hover();
            return {
              content: [{
                type: "text",
                text: `Hovered ${args.selector}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed to hover ${args.selector}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `Failed to hover ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserHoverText:
      try {
        await page.getByText(args.text).hover();
        return {
          content: [{
            type: "text",
            text: `Hovered element with text: ${args.text}`,
          }],
          isError: false,
        };
      } catch (error) {
        if ((error as Error).message.includes("strict mode violation")) {
          console.log("Strict mode violation, retrying on first element...");
          try {
            await page.getByText(args.text).first().hover();
            return {
              content: [{
                type: "text",
                text: `Hovered element with text: ${args.text}`,
              }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [{
                type: "text",
                text: `Failed (twice) to hover element with text ${args.text}: ${(error as Error).message}`,
              }],
              isError: true,
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `Failed to hover element with text ${args.text}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserEvaluate:
      try {
        const result = await page.evaluate((script) => {
          const logs: string[] = [];
          const originalConsole = { ...console };

          ['log', 'info', 'warn', 'error'].forEach(method => {
            (console as any)[method] = (...args: any[]) => {
              logs.push(`[${method}] ${args.join(' ')}`);
              (originalConsole as any)[method](...args);
            };
          });

          try {
            const result = eval(script);
            Object.assign(console, originalConsole);
            return { result, logs };
          } catch (error) {
            Object.assign(console, originalConsole);
            throw error;
          }
        }, args.script);

        return {
          content: [
            {
              type: "text",
              text: `Execution result:\n${JSON.stringify(result.result, null, 2)}\n\nConsole output:\n${result.logs.join('\n')}`,
            },
          ],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Script execution failed: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case ToolName.BrowserClickAndCapture: {
      try {
        const waitTime = args.waitTime || 10000;
        const selector = args.selector || 'button';

        // Store current URL for comparison later
        const startUrl = page.url();

        // Store initial pages count
        const initialPages = browser!.contexts()[0].pages().length;

        // Create a promise that will resolve with a new page if one is created
        const pagePromise = new Promise<Page | null>((resolve) => {
          browser!.contexts()[0].once('page', page => {
            resolve(page);
          });

          // Resolve with null if no new page appears within the timeout
          setTimeout(() => resolve(null), waitTime);
        });

        // Click the button
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;
        console.log(`Looking for button with selector: ${buttonSelector}`);

        try {
          await page.locator(buttonSelector).click();
          console.log(`Clicked button with text: ${args.buttonText}`);
        } catch (error) {
          if ((error as Error).message.includes("strict mode violation")) {
            console.log("Strict mode violation, retrying on first element...");
            await page.locator(buttonSelector).first().click();
            console.log(`Clicked first button with text: ${args.buttonText}`);
          } else {
            throw error;
          }
        }

        // Wait for potential new page
        const newPage = await pagePromise;

        // If a new page was created
        if (newPage) {
          await newPage.waitForLoadState('networkidle', { timeout: waitTime });
          const newUrl = newPage.url();

          return {
            content: [{
              type: "text",
              text: `Button clicked successfully. Redirected to new tab with URL: ${newUrl}`,
            }],
            isError: false,
          };
        }

        // If no new page, check if current page URL has changed
        await page.waitForTimeout(waitTime / 2); // Give it some time to potentially redirect
        const currentUrl = page.url();

        if (currentUrl !== startUrl) {
          return {
            content: [{
              type: "text",
              text: `Button clicked successfully. Page redirected to: ${currentUrl}`,
            }],
            isError: false,
          };
        }

        // Check if any new pages were created
        const finalPages = browser!.contexts()[0].pages().length;
        if (finalPages > initialPages) {
          const allPages = browser!.contexts()[0].pages();
          const lastPage = allPages[allPages.length - 1];
          await lastPage.waitForLoadState('networkidle', { timeout: waitTime / 2 });
          const newUrl = lastPage.url();

          return {
            content: [{
              type: "text",
              text: `Button clicked successfully. New tab detected with URL: ${newUrl}`,
            }],
            isError: false,
          };
        }

        // If no redirection happened
        return {
          content: [{
            type: "text",
            text: `Button clicked successfully, but no redirection was detected. Current URL: ${currentUrl}`,
          }],
          isError: false,
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to click button or capture redirect: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserDownloadPDF: {
      try {
        const waitTime = args.waitTime || 15000;
        const selector = args.selector || 'button, a';
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        // Create a context-level variable to track if we already resolved
        let handled = false;

        // Create a promise that will resolve with a new page if one is created
        const pagePromise = new Promise<Page | null>((resolve) => {
          const pageHandler = async (newPage: Page) => {
            if (handled) return;
            handled = true;

            try {
              // Add an event listener for close events
              newPage.once('close', () => {
                console.log('PDF page was closed before we could process it');
                if (!handled) {
                  handled = true;
                  resolve(null);
                }
              });

              // Wait for load but with a safety timeout
              try {
                await newPage.waitForLoadState('domcontentloaded', { timeout: waitTime / 2 });
              } catch (err) {
                console.log(`Error in waitForLoadState: ${(err as Error).message}`);
                resolve(newPage); // Continue anyway, might be PDF already loaded
              }

              resolve(newPage);
            } catch (err) {
              console.log(`Error handling new page: ${(err as Error).message}`);
              resolve(null);
            }
          };

          browser!.contexts()[0].once('page', pageHandler);

          // Remove our listener after timeout to prevent memory leaks
          setTimeout(() => {
            if (!handled) {
              handled = true;
              browser!.contexts()[0].removeListener('page', pageHandler);
              resolve(null);
            }
          }, waitTime);
        });

        // Click the button that should trigger PDF download
        console.log(`Looking for button with selector: ${buttonSelector}`);
        try {
          await page.locator(buttonSelector).click();
          console.log(`Clicked button with text: ${args.buttonText}`);
        } catch (error) {
          if ((error as Error).message.includes("strict mode violation")) {
            console.log("Strict mode violation, retrying on first element...");
            await page.locator(buttonSelector).first().click();
            console.log(`Clicked first button with text: ${args.buttonText}`);
          } else {
            throw error;
          }
        }

        // Wait for the new page
        const newPage = await pagePromise;

        if (!newPage) {
          return {
            content: [{
              type: "text",
              text: `Timeout or error waiting for PDF to load in new tab after clicking "${args.buttonText}"`,
            }],
            isError: true,
          };
        }

        let pdfBytes: string;
        let url: string;

        try {
          // Get the URL before trying other operations that might fail
          url = newPage.url();
          console.log(`New page URL: ${url}`);

          // Try to wait for network idle, but don't fail if it doesn't complete
          try {
            await newPage.waitForLoadState('networkidle', { timeout: waitTime / 2 });
          } catch (err) {
            console.log(`Warning: ${(err as Error).message}`);
            // Continue anyway
          }

          // Check if URL ends with .pdf or content type is PDF
          let isPDF = url.toLowerCase().endsWith('.pdf');

          // Only try evaluating content type if the page is still open
          if (!isPDF && !newPage.isClosed()) {
            try {
              isPDF = await newPage.evaluate(() =>
                document.contentType === 'application/pdf' ||
                document.querySelector('embed[type="application/pdf"]') !== null ||
                document.querySelector('object[type="application/pdf"]') !== null
              );
            } catch (err) {
              console.log(`Error checking PDF content type: ${(err as Error).message}`);
            }
          }

          if (!isPDF) {
            let contentType = "unknown";

            // Only try getting content type if page is still open
            if (!newPage.isClosed()) {
              try {
                contentType = await newPage.evaluate(() => document.contentType);
              } catch (err) {
                console.log(`Error getting content type: ${(err as Error).message}`);
              }
            }

            console.log(`Not a PDF. URL: ${url}, Content-Type: ${contentType}`);

            // Take a screenshot of what we got instead, if page is still open
            if (!newPage.isClosed()) {
              try {
                const screenshot = await newPage.screenshot();
                const screenshotName = `${args.fileName}_not_pdf`;
                screenshots.set(screenshotName, screenshot.toString('base64'));
                server.notification({
                  method: "notifications/resources/list_changed",
                });
              } catch (err) {
                console.log(`Error taking screenshot: ${(err as Error).message}`);
              }
            }

            return {
              content: [{
                type: "text",
                text: `The new tab did not contain a PDF. URL: ${url}, Content-Type: ${contentType}`,
              }],
              isError: true,
            };
          }

          // Try to get PDF content, handling possible page closure
          if (newPage.isClosed()) {
            throw new Error("Page was closed before PDF could be captured");
          }

          try {
            // Capture the PDF content as base64
            pdfBytes = await newPage.evaluate(async () => {
              try {
                const response = await fetch(window.location.href);
                if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);

                const blob = await response.blob();
                return await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const base64 = (reader.result as string).split(',')[1];
                    resolve(base64);
                  };
                  reader.readAsDataURL(blob);
                });
              } catch (error) {
                console.error("Error in PDF fetch:", error);
                throw error;
              }
            });
          } catch (err) {
            // If evaluate method failed, try downloading the PDF directly
            console.log(`Error in evaluate method: ${(err as Error).message}, trying direct download`);

            // Create a separate browser context with download permissions
            const context = await browser!.newContext({
              acceptDownloads: true
            });

            try {
              const downloadPage = await context.newPage();
              await downloadPage.goto(url);

              // Wait for download to start and save the downloaded file
              const downloadPromise = downloadPage.waitForEvent('download');
              await downloadPage.emulateMedia({ media: 'screen' });
              const download = await downloadPromise;

              // Save as bytes
              const path = await download.path();
              if (!path) throw new Error("Download path is null");

              const fileBuffer = await fs.readFile(path);
              pdfBytes = fileBuffer.toString('base64');

              await context.close();
            } catch (downloadErr) {
              await context.close();
              throw new Error(`Direct download failed: ${(downloadErr as Error).message}`);
            }
          }
        } catch (err) {
          // Handle any errors that occurred during PDF processing
          return {
            content: [{
              type: "text",
              text: `Error processing PDF: ${(err as Error).message}`,
            }],
            isError: true,
          };
        }

        // Close the new page after capturing PDF to avoid memory leaks
        try {
          if (newPage && !newPage.isClosed()) {
            await newPage.close();
          }
        } catch (err) {
          console.log(`Error closing page: ${(err as Error).message}`);
          // Continue anyway
        }

        // If we got here, we have PDF bytes
        if (!pdfBytes) {
          return {
            content: [{
              type: "text",
              text: `Failed to capture PDF content from ${url}`,
            }],
            isError: true,
          };
        }

        // Save the PDF with the given filename
        screenshots.set(args.fileName, pdfBytes);
        server.notification({
          method: "notifications/resources/list_changed",
        });

        return {
          content: [{
            type: "text",
            text: `Successfully downloaded PDF "${args.fileName}" from ${url}`,
          }],
          isError: false,
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to download PDF: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserForceDownload: {
      try {
        const waitTime = args.waitTime || 30000;
        const selector = args.selector || 'button, a';
        const fileTypes = (args.fileTypes || 'pdf,doc,docx,xls,xlsx,ppt,pptx,zip').split(',').map((t: string) => t.trim());
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        // Create a new context with download permissions
        const context = await browser!.newContext({
          acceptDownloads: true
        });

        // Create a new page in this context
        const downloadPage = await context.newPage();

        // Go to the same URL as the current page
        await downloadPage.goto(page.url());

        // We'll collect all requests to track what files are being requested
        const requestUrls: string[] = [];
        downloadPage.on('request', request => {
          const url = request.url();
          console.log(`Request: ${url}`);
          requestUrls.push(url);
        });

        // Setup a promise to wait for download
        const downloadPromise = downloadPage.waitForEvent('download', { timeout: waitTime });

        console.log(`Looking for button with selector: ${buttonSelector}`);

        // Click the button that should trigger download
        try {
          await downloadPage.locator(buttonSelector).click();
          console.log(`Clicked button with text: ${args.buttonText}`);
        } catch (error) {
          if ((error as Error).message.includes("strict mode violation")) {
            console.log("Strict mode violation, retrying on first element...");
            await downloadPage.locator(buttonSelector).first().click();
            console.log(`Clicked first button with text: ${args.buttonText}`);
          } else {
            // Close the context and throw the error
            await context.close();
            throw error;
          }
        }

        // Now we need to try multiple strategies to capture the download

        // Strategy 1: Try to use the built-in download event
        let download;
        try {
          console.log('Waiting for download event...');
          download = await downloadPromise;
          console.log(`Download started: ${download.suggestedFilename()}`);
        } catch (err) {
          console.log(`No download event detected: ${(err as Error).message}`);
          download = null;
        }

        // If we got a download through the event, save it
        if (download) {
          try {
            // Save as bytes
            const path = await download.path();
            if (!path) throw new Error("Download path is null");

            const fileBuffer = await fs.readFile(path);
            const fileBytes = fileBuffer.toString('base64');

            // Determine mime type from filename
            const suggestedName = download.suggestedFilename();
            const extension = suggestedName.split('.').pop()?.toLowerCase() || '';
            let mimeType = 'application/octet-stream';

            if (extension === 'pdf') mimeType = 'application/pdf';
            else if (['doc', 'docx'].includes(extension)) mimeType = 'application/msword';
            else if (['xls', 'xlsx'].includes(extension)) mimeType = 'application/vnd.ms-excel';
            else if (['ppt', 'pptx'].includes(extension)) mimeType = 'application/vnd.ms-powerpoint';

            // Save the file
            screenshots.set(args.fileName, fileBytes);

            // Update the MIME type mapping for this file
            fileTypeMappings.set(args.fileName, mimeType);

            server.notification({
              method: "notifications/resources/list_changed",
            });

            // Clean up
            await context.close();

            return {
              content: [{
                type: "text",
                text: `Successfully downloaded file "${args.fileName}" (original name: ${suggestedName})`,
              }],
              isError: false,
            };
          } catch (err) {
            console.log(`Error saving download: ${(err as Error).message}`);
            // Continue to next strategy
          }
        }

        // Strategy 2: Look for new windows/tabs that might have opened
        const pages = context.pages();
        if (pages.length > 1) {
          // A new page opened, try to capture content from it
          const newPage = pages[pages.length - 1];

          try {
            await newPage.waitForLoadState('domcontentloaded', { timeout: waitTime / 2 });
            const url = newPage.url();

            // Check if it's a direct file URL by extension
            const isDirectFile = fileTypes.some((type: string) => url.toLowerCase().endsWith(`.${type}`));

            if (isDirectFile) {
              console.log(`Direct file URL detected: ${url}`);

              // Fetch the file directly
              const response = await downloadPage.evaluate(async (fileUrl) => {
                try {
                  const response = await fetch(fileUrl);
                  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);

                  const blob = await response.blob();
                  return await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64 = (reader.result as string).split(',')[1];
                      resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                  });
                } catch (error) {
                  console.error("Error in file fetch:", error);
                  throw error;
                }
              }, url);

              // Determine file type
              const extension = url.split('.').pop()?.toLowerCase() || '';
              let mimeType = 'application/octet-stream';

              if (extension === 'pdf') mimeType = 'application/pdf';
              else if (['doc', 'docx'].includes(extension)) mimeType = 'application/msword';
              else if (['xls', 'xlsx'].includes(extension)) mimeType = 'application/vnd.ms-excel';
              else if (['ppt', 'pptx'].includes(extension)) mimeType = 'application/vnd.ms-powerpoint';

              // Save the file
              screenshots.set(args.fileName, response);

              // Update the MIME type mapping for this file
              fileTypeMappings.set(args.fileName, mimeType);

              server.notification({
                method: "notifications/resources/list_changed",
              });

              // Clean up
              await context.close();

              return {
                content: [{
                  type: "text",
                  text: `Successfully downloaded file "${args.fileName}" from URL: ${url}`,
                }],
                isError: false,
              };
            }

            // Check for PDF content
            const isPDF = await newPage.evaluate(() =>
              document.contentType === 'application/pdf' ||
              document.querySelector('embed[type="application/pdf"]') !== null ||
              document.querySelector('object[type="application/pdf"]') !== null
            ).catch(() => false);

            if (isPDF) {
              console.log(`PDF content detected in new page: ${url}`);

              // Extract the PDF content
              const pdfBytes = await newPage.evaluate(async () => {
                try {
                  const response = await fetch(window.location.href);
                  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);

                  const blob = await response.blob();
                  return await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64 = (reader.result as string).split(',')[1];
                      resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                  });
                } catch (error) {
                  console.error("Error in PDF fetch:", error);
                  throw error;
                }
              });

              // Save the file
              screenshots.set(args.fileName, pdfBytes);

              // Update the MIME type mapping
              fileTypeMappings.set(args.fileName, 'application/pdf');

              server.notification({
                method: "notifications/resources/list_changed",
              });

              // Clean up
              await context.close();

              return {
                content: [{
                  type: "text",
                  text: `Successfully downloaded PDF "${args.fileName}" from URL: ${url}`,
                }],
                isError: false,
              };
            }
          } catch (err) {
            console.log(`Error processing new page: ${(err as Error).message}`);
            // Continue to next strategy
          }
        }

        // Strategy 3: Analyze network requests and find file downloads
        console.log('Analyzing network requests...');

        // Look for any requests for file types we're interested in
        const fileRequests = requestUrls.filter((url: string) =>
          fileTypes.some((type: string) => url.toLowerCase().includes(`.${type}`))
        );

        if (fileRequests.length > 0) {
          // Try the last one first (most likely to be the one we want)
          const fileUrl = fileRequests[fileRequests.length - 1];
          console.log(`Found potential file URL: ${fileUrl}`);

          try {
            // Create a new page to download this file
            const filePage = await context.newPage();
            await filePage.goto(fileUrl);

            // Try to download the file content
            const fileContent = await filePage.evaluate(async () => {
              try {
                const response = await fetch(window.location.href);
                if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);

                const blob = await response.blob();
                return await new Promise<{ data: string, type: string }>((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const base64 = (reader.result as string).split(',')[1];
                    resolve({ data: base64, type: blob.type });
                  };
                  reader.readAsDataURL(blob);
                });
              } catch (error) {
                console.error("Error in file fetch:", error);
                throw error;
              }
            });

            // Determine MIME type
            let mimeType = fileContent.type || 'application/octet-stream';
            if (mimeType === '') mimeType = 'application/octet-stream';

            // Save the file
            screenshots.set(args.fileName, fileContent.data);

            // Update the MIME type mapping
            fileTypeMappings.set(args.fileName, mimeType);

            server.notification({
              method: "notifications/resources/list_changed",
            });

            // Clean up
            await context.close();

            return {
              content: [{
                type: "text",
                text: `Successfully downloaded file "${args.fileName}" from URL: ${fileUrl}`,
              }],
              isError: false,
            };
          } catch (err) {
            console.log(`Error downloading file from URL: ${(err as Error).message}`);
            // Try next file URL if available
          }
        }

        // If we get here, all strategies failed
        await context.close();

        return {
          content: [{
            type: "text",
            text: `Failed to download file. No file download was detected after clicking "${args.buttonText}". Requests captured: ${requestUrls.length}`,
          }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to force download: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserAuthenticatedDownload: {
      try {
        const waitTime = args.waitTime || 30000;
        const selector = args.selector || 'button, a';
        const closeNewTabs = args.closeNewTabs !== false; // Default to true
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        // Store current page URL and cookies before clicking
        const currentUrl = page.url();
        const cookies = await browser!.contexts()[0].cookies();
        console.log(`Current page URL: ${currentUrl}`);
        console.log(`Captured ${cookies.length} cookies from current session`);

        // Function to get all href attributes from a page
        const getAllLinks = async (targetPage: Page): Promise<string[]> => {
          return targetPage.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map(a => (a as HTMLAnchorElement).href)
              .filter(href => href && !href.startsWith('javascript:'));
          });
        };

        // Get all links before clicking
        const beforeLinks = await getAllLinks(page);
        console.log(`Found ${beforeLinks.length} links before clicking`);

        // Collect response URLs during the click operation
        const responseUrls: string[] = [];
        const listener = (response: playwright.Response) => {
          const url = response.url();
          responseUrls.push(url);
          console.log(`Response: ${url} (${response.status()})`);
        };

        page.on('response', listener);

        // Initial page count
        const initialPageCount = browser!.contexts()[0].pages().length;
        console.log(`Initial page count: ${initialPageCount}`);

        // Setup page event handler for new pages
        let newPagePromise = new Promise<Page | null>(resolve => {
          const pageHandler = (newPage: Page) => {
            console.log(`New page opened: ${newPage.url()}`);
            resolve(newPage);
          };

          browser!.contexts()[0].once('page', pageHandler);

          // Clean up after timeout
          setTimeout(() => {
            browser!.contexts()[0].removeListener('page', pageHandler);
            resolve(null);
          }, waitTime);
        });

        // Click the button that should trigger download
        try {
          console.log(`Looking for button with selector: ${buttonSelector}`);
          await page.locator(buttonSelector).click();
          console.log(`Clicked button with text: ${args.buttonText}`);
        } catch (error) {
          if ((error as Error).message.includes("strict mode violation")) {
            console.log("Strict mode violation, retrying on first element...");
            await page.locator(buttonSelector).first().click();
            console.log(`Clicked first button with text: ${args.buttonText}`);
          } else {
            throw error;
          }
        }

        // Wait a moment for any redirects or new tabs
        await page.waitForTimeout(1000);

        // Stop collecting responses
        page.removeListener('response', listener);

        // Check for new tab
        const newPage = await newPagePromise;
        let pdfBytes: string | null = null;
        let foundPdfUrl: string | null = null;

        // Strategy 1: Check if a new page was opened and contains PDF
        if (newPage) {
          try {
            console.log(`Checking new page at ${newPage.url()}`);
            await newPage.waitForLoadState('domcontentloaded', { timeout: waitTime / 2 }).catch(() => {
              console.log('New page load timed out, continuing anyway');
            });

            const newPageUrl = newPage.url();

            // Check if URL is directly a PDF
            if (newPageUrl.toLowerCase().endsWith('.pdf')) {
              console.log(`Direct PDF URL detected: ${newPageUrl}`);
              foundPdfUrl = newPageUrl;
            } else {
              // Check content type
              const contentType = await newPage.evaluate(() => document.contentType).catch(() => 'unknown');
              console.log(`New page content type: ${contentType}`);

              if (contentType === 'application/pdf') {
                console.log(`PDF content detected in new page`);
                foundPdfUrl = newPageUrl;
              } else {
                // Look for PDF embed or object tags
                const hasPdfEmbed = await newPage.evaluate(() => {
                  return (
                    document.querySelector('embed[type="application/pdf"]') !== null ||
                    document.querySelector('object[type="application/pdf"]') !== null
                  );
                }).catch(() => false);

                if (hasPdfEmbed) {
                  console.log(`PDF embed detected in new page`);
                  foundPdfUrl = newPageUrl;
                }
              }
            }

            // If new page has PDF, try to download it
            if (foundPdfUrl) {
              try {
                // Try to extract PDF content - wrap in try/catch
                pdfBytes = await newPage.evaluate(async () => {
                  try {
                    const response = await fetch(window.location.href);
                    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);

                    const blob = await response.blob();
                    return await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const base64 = (reader.result as string).split(',')[1];
                        resolve(base64);
                      };
                      reader.readAsDataURL(blob);
                    });
                  } catch (error) {
                    console.error("Error in PDF fetch:", error);
                    return null;
                  }
                });

                if (pdfBytes) {
                  console.log('Successfully extracted PDF content from new page');
                }
              } catch (err) {
                console.log(`Error extracting PDF from new page: ${(err as Error).message}`);
              }
            }
          } catch (err) {
            console.log(`Error handling new page: ${(err as Error).message}`);
          }
        }

        // Strategy 2: Check if current page URL changed to a PDF
        if (!pdfBytes && !foundPdfUrl) {
          const currentPageUrl = page.url();
          if (currentPageUrl !== currentUrl) {
            console.log(`Current page URL changed to: ${currentPageUrl}`);

            if (currentPageUrl.toLowerCase().endsWith('.pdf')) {
              console.log(`Current page redirected to PDF URL`);
              foundPdfUrl = currentPageUrl;
            }
          }
        }

        // Strategy 3: Look for PDF URLs in responses
        if (!pdfBytes && !foundPdfUrl) {
          const pdfResponses = responseUrls.filter(url =>
            url.toLowerCase().endsWith('.pdf') ||
            url.toLowerCase().includes('.pdf?') ||
            url.toLowerCase().includes('/pdf/')
          );

          if (pdfResponses.length > 0) {
            console.log(`Found ${pdfResponses.length} potential PDF URLs in responses`);
            foundPdfUrl = pdfResponses[pdfResponses.length - 1]; // Use last one
          }
        }

        // Strategy 4: Get all links after clicking to see if new PDF links appeared
        if (!pdfBytes && !foundPdfUrl) {
          const afterLinks = await getAllLinks(page);
          const newLinks = afterLinks.filter(link => !beforeLinks.includes(link));
          console.log(`Found ${newLinks.length} new links after clicking`);

          const pdfLinks = newLinks.filter(link =>
            link.toLowerCase().endsWith('.pdf') ||
            link.toLowerCase().includes('.pdf?') ||
            link.toLowerCase().includes('/pdf/')
          );

          if (pdfLinks.length > 0) {
            console.log(`Found ${pdfLinks.length} potential PDF links`);
            foundPdfUrl = pdfLinks[0]; // Use first one
          }
        }

        // If we found a PDF URL but couldn't extract content yet, create an authenticated page to download it
        if (foundPdfUrl && !pdfBytes) {
          console.log(`Attempting to download PDF from URL: ${foundPdfUrl}`);

          // Create a new context with the same cookies
          const context = await browser!.newContext({
            acceptDownloads: true
          });

          // Set the cookies from the original session
          await context.addCookies(cookies);

          // Create a new page and navigate to the PDF URL
          const downloadPage = await context.newPage();

          try {
            // Navigate to the PDF URL
            await downloadPage.goto(foundPdfUrl, { waitUntil: 'networkidle', timeout: waitTime });

            // Try direct content extraction first
            try {
              pdfBytes = await downloadPage.evaluate(async () => {
                try {
                  const response = await fetch(window.location.href);
                  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);

                  const blob = await response.blob();
                  return await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64 = (reader.result as string).split(',')[1];
                      resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                  });
                } catch (error) {
                  console.error("Error in PDF fetch:", error);
                  return null;
                }
              });

              if (pdfBytes) {
                console.log('Successfully extracted PDF content from authenticated page');
              }
            } catch (err) {
              console.log(`Error extracting PDF content: ${(err as Error).message}`);
            }

            // If content extraction failed, try downloading the file
            if (!pdfBytes) {
              try {
                console.log('Attempting to download PDF using browser download handler');

                // Set up download handler
                const downloadPromise = downloadPage.waitForEvent('download', { timeout: waitTime / 2 });

                // Click on the page to trigger download if needed
                await downloadPage.click('body');

                // Wait for download
                const download = await downloadPromise;
                console.log(`Download started: ${download.suggestedFilename()}`);

                // Save as bytes
                const path = await download.path();
                if (!path) throw new Error("Download path is null");

                const fileBuffer = await fs.readFile(path);
                pdfBytes = fileBuffer.toString('base64');
                console.log('Successfully downloaded PDF using browser download handler');
              } catch (err) {
                console.log(`Download attempt failed: ${(err as Error).message}`);
              }
            }

            // Clean up this context
            await context.close();
          } catch (err) {
            console.log(`Error with authenticated download page: ${(err as Error).message}`);
            await context.close();
          }
        }

        // Clean up any new tabs if needed
        if (closeNewTabs && newPage && !newPage.isClosed()) {
          try {
            await newPage.close();
            console.log('Closed new tab');
          } catch (err) {
            console.log(`Error closing tab: ${(err as Error).message}`);
          }
        }

        // If we've got PDF bytes, save them
        if (pdfBytes) {
          // Save the PDF with the given filename
          screenshots.set(args.fileName, pdfBytes);
          fileTypeMappings.set(args.fileName, 'application/pdf');

          server.notification({
            method: "notifications/resources/list_changed",
          });

          return {
            content: [{
              type: "text",
              text: foundPdfUrl
                ? `Successfully downloaded PDF "${args.fileName}" from ${foundPdfUrl}`
                : `Successfully downloaded PDF "${args.fileName}"`,
            }],
            isError: false,
          };
        }

        // If we have a URL but couldn't download, return the URL for manual download
        if (foundPdfUrl) {
          return {
            content: [{
              type: "text",
              text: `Found PDF URL but couldn't download automatically. Manual download URL: ${foundPdfUrl}`,
            }],
            isError: true,
          };
        }

        // If we get here, we failed to find or download the PDF
        return {
          content: [{
            type: "text",
            text: `Failed to find or download PDF after clicking "${args.buttonText}". No PDF content or link was detected.`,
          }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error during authenticated download: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserCaptureRequest: {
      try {
        const waitTime = args.waitTime || 15000;
        const selector = args.selector || 'button, a';
        const blockWindowOpen = args.blockWindowOpen !== false; // Default to true
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        // Store all network requests
        const requests: { url: string, resourceType: string, method: string }[] = [];
        const responses: { url: string, status: number, headers: Record<string, string> }[] = [];

        // Logging helper
        const logState = () => {
          console.log(`\n=== NETWORK CAPTURE SUMMARY ===`);
          console.log(`Total Requests: ${requests.length}`);
          console.log(`Total Responses: ${responses.length}`);

          // Log PDF-related requests
          const pdfRequests = requests.filter(r =>
            r.url.toLowerCase().endsWith('.pdf') ||
            r.url.toLowerCase().includes('.pdf?') ||
            r.url.toLowerCase().includes('/pdf/')
          );

          console.log(`\nPDF-related Requests (${pdfRequests.length}):`);
          pdfRequests.forEach(r => console.log(`- ${r.method} ${r.url} (${r.resourceType})`));

          // Log download-related requests
          const downloadRequests = requests.filter(r =>
            r.url.toLowerCase().includes('/download/') ||
            r.url.toLowerCase().includes('download=') ||
            r.url.toLowerCase().includes('export=')
          );

          if (downloadRequests.length > 0 && downloadRequests.some(r => !pdfRequests.some(p => p.url === r.url))) {
            console.log(`\nDownload-related Requests (${downloadRequests.length}):`);
            downloadRequests.forEach(r => console.log(`- ${r.method} ${r.url} (${r.resourceType})`));
          }

          // Log successful responses with PDF content type
          const pdfResponses = responses.filter(r =>
            r.status >= 200 && r.status < 300 &&
            (r.headers['content-type']?.toLowerCase().includes('pdf') ||
              pdfRequests.some(req => req.url === r.url))
          );

          console.log(`\nPDF Responses (${pdfResponses.length}):`);
          pdfResponses.forEach(r => console.log(`- ${r.url} (Status: ${r.status}, Type: ${r.headers['content-type'] || 'unknown'})`));

          console.log(`\n===============================\n`);
        };

        // Setup network event listeners
        page.on('request', request => {
          requests.push({
            url: request.url(),
            resourceType: request.resourceType(),
            method: request.method()
          });
        });

        page.on('response', response => {
          // Extract relevant headers
          const headersObj: Record<string, string> = {};
          const headers = response.headers();

          // Convert headers to a simple object
          for (const key in headers) {
            headersObj[key.toLowerCase()] = headers[key];
          }

          responses.push({
            url: response.url(),
            status: response.status(),
            headers: headersObj
          });

          // If this is a PDF response, we want to capture it
          if (
            (response.status() >= 200 && response.status() < 300) &&
            (
              headersObj['content-type']?.toLowerCase().includes('pdf') ||
              response.url().toLowerCase().endsWith('.pdf') ||
              response.url().toLowerCase().includes('.pdf?')
            )
          ) {
            console.log(`Detected potential PDF response: ${response.url()}`);
          }
        });

        // Block window.open if requested
        if (blockWindowOpen) {
          await page.addInitScript(() => {
            const originalWindowOpen = window.open;
            window.open = function (url?: string | URL, target?: string, features?: string) {
              console.log(`[Blocked] window.open call with URL: ${url}`);
              // Return a mock window object that does nothing
              return {
                focus: () => { },
                blur: () => { },
                close: () => { },
                closed: false,
                // Add other window properties as needed
              } as Window;
            };
            console.log('Blocked window.open calls');
          });
        }

        // Get all current links before clicking
        const beforeLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => (a as HTMLAnchorElement).href)
            .filter(href => href && !href.startsWith('javascript:'));
        });

        console.log(`Found ${beforeLinks.length} links before clicking`);

        // Click the button that should trigger the PDF request
        console.log(`Looking for button with selector: ${buttonSelector}`);
        try {
          await page.locator(buttonSelector).click();
          console.log(`Clicked button with text: ${args.buttonText}`);
        } catch (error) {
          if ((error as Error).message.includes("strict mode violation")) {
            console.log("Strict mode violation, retrying on first element...");
            await page.locator(buttonSelector).first().click();
            console.log(`Clicked first button with text: ${args.buttonText}`);
          } else {
            throw error;
          }
        }

        // Wait for network activity to settle
        console.log(`Waiting for ${waitTime}ms to capture network activity...`);
        await page.waitForTimeout(waitTime);

        // Log the final state
        logState();

        // Strategy 1: Look for successful PDF responses
        const pdfResponses = responses.filter(r =>
          r.status >= 200 && r.status < 300 &&
          (r.headers['content-type']?.toLowerCase().includes('pdf') ||
            r.url.toLowerCase().endsWith('.pdf') ||
            r.url.toLowerCase().includes('.pdf?') ||
            r.url.toLowerCase().includes('/pdf/'))
        );

        if (pdfResponses.length > 0) {
          // Try to download each PDF response, starting with the last one (most likely to be the one we want)
          for (let i = pdfResponses.length - 1; i >= 0; i--) {
            const pdfResponse = pdfResponses[i];
            console.log(`Attempting to download PDF from response: ${pdfResponse.url}`);

            try {
              // Try to fetch the PDF directly in the browser context
              const pdfBytes = await page.evaluate(async (url) => {
                try {
                  // Use fetch with credentials to maintain authentication
                  const response = await fetch(url, { credentials: 'include' });
                  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);

                  // Check if content type is PDF
                  const contentType = response.headers.get('content-type');
                  if (contentType && !contentType.toLowerCase().includes('pdf')) {
                    console.warn(`Warning: Response is not a PDF. Content-Type: ${contentType}`);
                  }

                  const blob = await response.blob();
                  return await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64 = (reader.result as string).split(',')[1];
                      resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                  });
                } catch (error) {
                  console.error("Error in PDF fetch:", error);
                  return null;
                }
              }, pdfResponse.url);

              if (pdfBytes) {
                console.log(`Successfully downloaded PDF from ${pdfResponse.url}`);

                // Save the PDF
                screenshots.set(args.fileName, pdfBytes);
                fileTypeMappings.set(args.fileName, 'application/pdf');

                server.notification({
                  method: "notifications/resources/list_changed",
                });

                return {
                  content: [{
                    type: "text",
                    text: `Successfully downloaded PDF "${args.fileName}" from network request to ${pdfResponse.url}`,
                  }],
                  isError: false,
                };
              }
            } catch (err) {
              console.log(`Error downloading PDF from response: ${(err as Error).message}`);
              // Continue to the next response
            }
          }
        }

        // Strategy 2: Look for new links that appeared after clicking
        const afterLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => (a as HTMLAnchorElement).href)
            .filter(href => href && !href.startsWith('javascript:'));
        });

        const newLinks = afterLinks.filter(link => !beforeLinks.includes(link));
        console.log(`Found ${newLinks.length} new links after clicking`);

        const pdfLinks = newLinks.filter(link =>
          link.toLowerCase().endsWith('.pdf') ||
          link.toLowerCase().includes('.pdf?') ||
          link.toLowerCase().includes('/pdf/') ||
          link.toLowerCase().includes('/download/')
        );

        if (pdfLinks.length > 0) {
          console.log(`Found ${pdfLinks.length} potential PDF links after clicking`);

          // Try to download each PDF link
          for (const pdfLink of pdfLinks) {
            console.log(`Attempting to download PDF from link: ${pdfLink}`);

            try {
              // Try to fetch the PDF in the browser context
              const pdfBytes = await page.evaluate(async (url) => {
                try {
                  const response = await fetch(url, { credentials: 'include' });
                  if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);

                  const blob = await response.blob();
                  return await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64 = (reader.result as string).split(',')[1];
                      resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                  });
                } catch (error) {
                  console.error("Error in PDF fetch:", error);
                  return null;
                }
              }, pdfLink);

              if (pdfBytes) {
                console.log(`Successfully downloaded PDF from ${pdfLink}`);

                // Save the PDF
                screenshots.set(args.fileName, pdfBytes);
                fileTypeMappings.set(args.fileName, 'application/pdf');

                server.notification({
                  method: "notifications/resources/list_changed",
                });

                return {
                  content: [{
                    type: "text",
                    text: `Successfully downloaded PDF "${args.fileName}" from link: ${pdfLink}`,
                  }],
                  isError: false,
                };
              }
            } catch (err) {
              console.log(`Error downloading PDF from link: ${(err as Error).message}`);
              // Continue to the next link
            }
          }
        }

        // Strategy 3: Look for XHR/Fetch requests that might be for a PDF
        const potentialPdfRequests = requests.filter(r =>
          (r.resourceType === 'xhr' || r.resourceType === 'fetch') &&
          (r.url.toLowerCase().includes('pdf') ||
            r.url.toLowerCase().includes('download') ||
            r.url.toLowerCase().includes('export') ||
            r.url.toLowerCase().includes('file'))
        );

        if (potentialPdfRequests.length > 0) {
          console.log(`Found ${potentialPdfRequests.length} potential PDF/download XHR requests`);

          // Try each request, starting with the last one (most likely to be the one we want)
          for (let i = potentialPdfRequests.length - 1; i >= 0; i--) {
            const req = potentialPdfRequests[i];
            console.log(`Attempting to download from XHR request: ${req.url}`);

            try {
              // Try to fetch the PDF directly
              const pdfBytes = await page.evaluate(async (url) => {
                try {
                  const response = await fetch(url, { credentials: 'include' });
                  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

                  // Check content type
                  const contentType = response.headers.get('content-type');
                  console.log(`Response content type: ${contentType}`);

                  // If it's clearly not a PDF, skip
                  if (contentType &&
                    (contentType.toLowerCase().includes('html') ||
                      contentType.toLowerCase().includes('json'))) {
                    return null;
                  }

                  const blob = await response.blob();
                  return await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const base64 = (reader.result as string).split(',')[1];
                      resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                  });
                } catch (error) {
                  console.error("Error in fetch:", error);
                  return null;
                }
              }, req.url);

              if (pdfBytes) {
                console.log(`Successfully downloaded content from XHR request to ${req.url}`);

                // Save the file
                screenshots.set(args.fileName, pdfBytes);

                // Try to determine the file type based on response headers
                const response = responses.find(r => r.url === req.url);
                let mimeType = 'application/octet-stream'; // default

                if (response && response.headers['content-type']) {
                  mimeType = response.headers['content-type'].split(';')[0];
                } else if (req.url.toLowerCase().endsWith('.pdf')) {
                  mimeType = 'application/pdf';
                }

                fileTypeMappings.set(args.fileName, mimeType);

                server.notification({
                  method: "notifications/resources/list_changed",
                });

                return {
                  content: [{
                    type: "text",
                    text: `Successfully downloaded file "${args.fileName}" (type: ${mimeType}) from XHR request to ${req.url}`,
                  }],
                  isError: false,
                };
              }
            } catch (err) {
              console.log(`Error downloading from XHR request: ${(err as Error).message}`);
              // Continue to the next request
            }
          }
        }

        // If we have PDF URLs but couldn't download, at least return the first one
        if (pdfResponses.length > 0) {
          return {
            content: [{
              type: "text",
              text: `Found PDF URL but couldn't download automatically. Manual download URL: ${pdfResponses[pdfResponses.length - 1].url}`,
            }],
            isError: true,
          };
        } else if (pdfLinks.length > 0) {
          return {
            content: [{
              type: "text",
              text: `Found PDF link but couldn't download automatically. Manual download URL: ${pdfLinks[0]}`,
            }],
            isError: true,
          };
        } else if (potentialPdfRequests.length > 0) {
          return {
            content: [{
              type: "text",
              text: `Found potential download request but couldn't extract file. URL: ${potentialPdfRequests[potentialPdfRequests.length - 1].url}`,
            }],
            isError: true,
          };
        }

        // If we get here, we couldn't find any PDF
        return {
          content: [{
            type: "text",
            text: `No PDF content was detected in network traffic after clicking "${args.buttonText}". Try examining the network activity in browser devtools manually.`,
          }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error capturing requests: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserInterceptTabs: {
      try {
        const waitTime = args.waitTime || 5000;
        const selector = args.selector || 'button, a';
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        console.log(`Looking for button with selector: ${buttonSelector}`);

        // Locate the button first
        const buttonHandle = await page.locator(buttonSelector).first(); // Use first() to avoid strict mode issues here
        if (!await buttonHandle.isVisible()) {
          throw new Error(`Button with text "${args.buttonText}" not found or not visible.`);
        }
        console.log(`Found button with text: ${args.buttonText}`);

        // ** NEW DIAGNOSTIC STEP: Inspect the button **
        const buttonInfo = await buttonHandle.evaluate(button => {
          const info: Record<string, any> = {};
          info.tagName = button.tagName;
          info.attributes = {};
          for (const attr of Array.from(button.attributes)) {
            info.attributes[attr.name] = attr.value;
          }
          info.outerHTML = button.outerHTML.substring(0, 200) + (button.outerHTML.length > 200 ? '...' : ''); // Limit HTML length

          // Cannot reliably get event listeners via evaluate
          info.eventListeners = 'Cannot determine listeners via automation';

          return info;
        });

        console.log('\n--- BUTTON DIAGNOSTICS ---');
        console.log(`Tag Name: ${buttonInfo.tagName}`);
        console.log('Attributes:');
        for (const attr in buttonInfo.attributes) {
          console.log(`  ${attr}: ${buttonInfo.attributes[attr]}`);
        }
        console.log(`Outer HTML (partial): ${buttonInfo.outerHTML}`);
        console.log(`Event Listeners: ${buttonInfo.eventListeners}`); // Updated log message
        console.log('--------------------------\n');
        // ** END NEW DIAGNOSTIC STEP **

        // Inject code to intercept window.open, tab creation, etc.
        await page.evaluate(() => {
          // Add logging to help debug
          console.log("Installing tab intercept hooks...");

          // Store intercepted URLs
          (window as any).__interceptedUrls = [];
          (window as any).__lastInterceptedUrl = null;

          // Helper to log and store URLs
          function captureUrl(method: string, url: string | URL) {
            const urlString = url?.toString() || '';
            const message = `[INTERCEPTED] ${method}: ${urlString}`;
            console.log(message);

            // Store it for retrieval
            (window as any).__interceptedUrls.push({
              method,
              url: urlString,
              time: new Date().toISOString()
            });
            (window as any).__lastInterceptedUrl = urlString;
          }

          // Hook window.open
          const originalWindowOpen = window.open;
          window.open = function (url?: string | URL, target?: string, features?: string) {
            if (url) {
              captureUrl('window.open', url);
            }

            // Return a mock window object that does nothing
            return {
              focus: () => { },
              blur: () => { },
              close: () => { },
              closed: false,
            } as Window;
          };

          // Hook all anchor tags' click events
          document.addEventListener('click', function (e) {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a') as HTMLAnchorElement;

            if (anchor && anchor.href && (anchor.target === '_blank' || anchor.getAttribute('rel') === 'noopener')) {
              captureUrl('a[target=_blank].click', anchor.href);
            }
          }, true);

          // Hook location changes
          const originalAssign = window.location.assign;
          window.location.assign = function (url: string | URL) {
            captureUrl('location.assign', url);
            return originalAssign.apply(window.location, [url]);
          };

          const originalReplace = window.location.replace;
          window.location.replace = function (url: string | URL) {
            captureUrl('location.replace', url);
            return originalReplace.apply(window.location, [url]);
          };

          // Hook HTMLFormElement.submit
          const originalSubmit = HTMLFormElement.prototype.submit;
          HTMLFormElement.prototype.submit = function () {
            const form = this as HTMLFormElement;
            const formData = new FormData(form);
            const formDataStr = Array.from(formData.entries())
              .map(([key, value]) => `${key}=${value}`)
              .join('&');

            captureUrl('form.submit', form.action + '?' + formDataStr);
            return originalSubmit.apply(this);
          };

          // Hook various DOM methods that might be used for navigation
          const originalCreateElement = document.createElement;
          document.createElement = function (tagName: string, options?: ElementCreationOptions) {
            const element = originalCreateElement.call(document, tagName, options);

            if (tagName.toLowerCase() === 'iframe' || tagName.toLowerCase() === 'frame') {
              const originalSetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')?.set;
              if (originalSetter) {
                Object.defineProperty(element, 'src', {
                  set: function (url) {
                    captureUrl('iframe.src', url);
                    originalSetter.call(this, url);
                  },
                  get: function () {
                    return this.getAttribute('src');
                  }
                });
              }
            }

            return element;
          };

          console.log("Tab intercept hooks installed");
        });

        console.log("Successfully installed URL interception hooks");

        // Click the button that should trigger new tab
        console.log(`Clicking button with selector: ${buttonSelector}`);
        await buttonHandle.click(); // Use the handle we already found
        console.log(`Clicked button with text: ${args.buttonText}`);

        // Wait a moment for JavaScript to execute
        console.log(`Waiting ${waitTime}ms for JavaScript to execute...`);
        await page.waitForTimeout(waitTime);

        // Retrieve the intercepted URLs
        const interceptResult = await page.evaluate(() => {
          return {
            urls: (window as any).__interceptedUrls || [],
            lastUrl: (window as any).__lastInterceptedUrl || null
          };
        });

        console.log(`Intercepted ${interceptResult.urls.length} URLs`);
        interceptResult.urls.forEach((item: any, index: number) => {
          console.log(`[${index}] ${item.method}: ${item.url} (${item.time})`);
        });

        // Additional check for common methods sites use to open PDFs
        const jsURLs = await page.evaluate(() => {
          const scriptUrls: string[] = [];
          document.querySelectorAll('script').forEach(script => {
            if (script.textContent) {
              const pdfMatches = script.textContent.match(/(['"])(https?:\/\/[^'"]*\.pdf[^'"]*)\1/g);
              if (pdfMatches) {
                pdfMatches.forEach(match => {
                  const url = match.slice(1, -1);
                  scriptUrls.push(url);
                });
              }
              const windowOpenMatches = script.textContent.match(/window\.open\(['"]([^'"]+)['"]/g);
              if (windowOpenMatches) {
                windowOpenMatches.forEach(match => {
                  const url = match.match(/\(['"]([^'"]+)['"]/)?.[1];
                  if (url) scriptUrls.push(url);
                });
              }
            }
          });
          return scriptUrls;
        });

        console.log(`Found ${jsURLs.length} URLs potentially embedded in script tags`);
        jsURLs.forEach((url, index) => {
          console.log(`[${index}] Script URL: ${url}`);
        });

        // Combine all the URLs we found
        const allPotentialUrls = [
          ...interceptResult.urls.map((item: any) => item.url),
          ...jsURLs
        ].filter(Boolean); // Filter out null/empty strings

        // Filter to only include PDF URLs or likely download URLs
        const pdfUrls = allPotentialUrls.filter(url =>
          url && (
            url.toLowerCase().endsWith('.pdf') ||
            url.toLowerCase().includes('.pdf?') ||
            url.toLowerCase().includes('/pdf/') ||
            url.toLowerCase().includes('/download/') ||
            url.toLowerCase().includes('/report/') || // Add common reporting paths
            url.toLowerCase().includes('/generate/') // Add common generation paths
          )
        );

        console.log(`Found ${pdfUrls.length} potential PDF or download URLs after filtering`);

        if (pdfUrls.length > 0) {
          // Try to download the *last* found URL, as it might be the final one generated
          const pdfUrl = pdfUrls[pdfUrls.length - 1];
          console.log(`Attempting to download PDF from the most likely intercepted/found URL: ${pdfUrl}`);

          try {
            const context = await browser!.newContext({
              acceptDownloads: true
            });
            const cookies = await page.context().cookies();
            await context.addCookies(cookies);
            const downloadPage = await context.newPage();

            try {
              await downloadPage.goto(pdfUrl, {
                waitUntil: 'domcontentloaded',
                timeout: waitTime * 2 // Give more time for download page
              });

              let pdfBytes: string | null = null;

              // Try direct extraction first
              try {
                pdfBytes = await downloadPage.evaluate(async () => {
                  try {
                    const response = await fetch(window.location.href, { credentials: 'include' });
                    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
                    const contentType = response.headers.get('content-type');
                    const isPdf = contentType?.toLowerCase().includes('pdf');
                    if (!isPdf) {
                      console.warn(`Warning: Response is not a PDF. Content-Type: ${contentType}`);
                    }
                    const blob = await response.blob();
                    return await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        try {
                          const base64 = (reader.result as string).split(',')[1];
                          resolve(base64);
                        } catch (e) {
                          console.error('Error in FileReader:', e);
                          resolve('');
                        }
                      };
                      reader.onerror = () => resolve('');
                      reader.readAsDataURL(blob);
                    });
                  } catch (error) {
                    console.error("Error in PDF fetch:", error);
                    return null;
                  }
                });
              } catch (err) {
                console.log(`Error extracting PDF directly: ${(err as Error).message}`);
              }

              // Try download handler if extraction failed
              if (!pdfBytes) {
                try {
                  console.log('Attempting to download using browser download handler');
                  const downloadPromise = downloadPage.waitForEvent('download', { timeout: waitTime });
                  await downloadPage.click('body').catch(() => { }); // Trigger download if needed
                  const download = await downloadPromise;
                  console.log(`Download started: ${download.suggestedFilename()}`);
                  const path = await download.path();
                  if (!path) throw new Error("Download path is null");
                  const fileBuffer = await fs.readFile(path);
                  pdfBytes = fileBuffer.toString('base64');
                  console.log('Successfully downloaded file using browser download handler');
                } catch (err) {
                  console.log(`Download attempt failed: ${(err as Error).message}`);
                }
              }

              await context.close();

              if (pdfBytes) {
                screenshots.set(args.fileName, pdfBytes);
                const fileTypeMappingRef = fileTypeMappings;
                fileTypeMappingRef.set(args.fileName, 'application/pdf');
                const serverRef = server;
                serverRef.notification({
                  method: "notifications/resources/list_changed",
                });
                return {
                  content: [{
                    type: "text",
                    text: `Successfully downloaded PDF "${args.fileName}" from intercepted URL: ${pdfUrl}`,
                  }],
                  isError: false,
                };
              }

              return {
                content: [{
                  type: "text",
                  text: `Found PDF URL but couldn't download automatically. Direct download URL: ${pdfUrl}`,
                }],
                isError: false,
              };
            } catch (err) {
              await context.close();
              console.log(`Error with download page: ${(err as Error).message}`);
              return {
                content: [{
                  type: "text",
                  text: `Found PDF URL but failed to access/download it. URL: ${pdfUrl}, Error: ${(err as Error).message}`,
                }],
                isError: true, // Mark as error since download failed
              };
            }
          } catch (err) {
            console.log(`Error creating download context: ${(err as Error).message}`);
            return {
              content: [{
                type: "text",
                text: `Found PDF URL but couldn't initiate download. Direct download URL: ${pdfUrl}`,
              }],
              isError: false, // Return URL, not an error state for the tool itself
            };
          }
        }

        // No PDF URLs found
        const lastInterceptedUrl = interceptResult.lastUrl;
        if (lastInterceptedUrl) {
          return {
            content: [{
              type: "text",
              text: `No PDF URL found, but intercepted this URL: ${lastInterceptedUrl}. Check button diagnostics in logs.`,
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: `No URLs were intercepted after clicking "${args.buttonText}". Check button diagnostics in logs.`,
          }],
          isError: true,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error intercepting tab: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserClickAndExtractUrl: {
      try {
        const waitTime = args.waitTime || 5000;
        const selector = args.selector || 'button, a';
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        console.log(`Looking for button with selector: ${buttonSelector}`);

        // Locate the button first
        const buttonHandle = await page.locator(buttonSelector).first();
        if (!await buttonHandle.isVisible()) {
          throw new Error(`Button with text "${args.buttonText}" not found or not visible.`);
        }
        console.log(`Found button with text: ${args.buttonText}`);

        // --- Promise setup for early exit ---
        let foundUrlResolve: (url: string | null) => void;
        const urlFoundPromise = new Promise<string | null>((resolve) => {
          foundUrlResolve = resolve;
        });

        // Expose a function for the browser script to call when a URL is found
        await page.exposeFunction('__reportUrlFound__', (url: string) => {
          console.log(`[Callback] URL reported: ${url}`);
          // Resolve the promise to signal that we found the URL
          if (foundUrlResolve) {
            foundUrlResolve(url);
          }
        });
        // --- End Promise setup ---

        // Inject code to intercept window.open, tab creation, etc.
        await page.evaluate(() => {
          console.log("Installing URL intercept hooks...");
          (window as any).__interceptedUrls = [];
          (window as any).__lastInterceptedUrl = null;

          // Define the URL pattern check within the browser context
          const isTargetUrl = (url: string): boolean => {
            if (!url) return false;
            const lowerUrl = url.toLowerCase();
            return (
              lowerUrl.endsWith('.pdf') ||
              lowerUrl.includes('.pdf?') ||
              lowerUrl.includes('/pdf/') ||
              lowerUrl.includes('/download/') ||
              lowerUrl.includes('/report/') ||
              lowerUrl.includes('/generate/') ||
              lowerUrl.includes('blob:')
            );
          };

          function captureUrl(method: string, url: string | URL) {
            const urlString = url?.toString() || '';
            const message = `[INTERCEPTED] ${method}: ${urlString}`;
            console.log(message);
            (window as any).__interceptedUrls.push({ method, url: urlString, time: new Date().toISOString() });
            (window as any).__lastInterceptedUrl = urlString;

            // ** NEW: Check if it's a target URL and report back **
            if (isTargetUrl(urlString)) {
              console.log(`Target URL detected, reporting back: ${urlString}`);
              (window as any).__reportUrlFound__(urlString);
            }
          }

          const originalWindowOpen = window.open;
          window.open = function (url?: string | URL, target?: string, features?: string) {
            if (url) { captureUrl('window.open', url); }
            return { focus: () => { }, blur: () => { }, close: () => { }, closed: false } as Window;
          };

          document.addEventListener('click', function (e) {
            const target = e.target as HTMLElement;
            const anchor = target.closest('a') as HTMLAnchorElement;
            if (anchor && anchor.href && (anchor.target === '_blank' || anchor.getAttribute('rel') === 'noopener')) {
              captureUrl('a[target=_blank].click', anchor.href);
            }
          }, true);

          const originalAssign = window.location.assign;
          window.location.assign = function (url: string | URL) {
            captureUrl('location.assign', url);
            return originalAssign.apply(window.location, [url]);
          };

          const originalReplace = window.location.replace;
          window.location.replace = function (url: string | URL) {
            captureUrl('location.replace', url);
            return originalReplace.apply(window.location, [url]);
          };

          const originalSubmit = HTMLFormElement.prototype.submit;
          HTMLFormElement.prototype.submit = function () {
            const form = this as HTMLFormElement;
            const formData = new FormData(form);
            const formDataStr = Array.from(formData.entries()).map(([k, v]) => `${k}=${v}`).join('&');
            captureUrl('form.submit', form.action + '?' + formDataStr);
            return originalSubmit.apply(this);
          };

          const originalCreateElement = document.createElement;
          document.createElement = function (tagName: string, options?: ElementCreationOptions) {
            const element = originalCreateElement.call(document, tagName, options);
            if (tagName.toLowerCase() === 'iframe' || tagName.toLowerCase() === 'frame') {
              const originalSetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')?.set;
              if (originalSetter) {
                Object.defineProperty(element, 'src', {
                  set: function (url) { captureUrl('iframe.src', url); originalSetter.call(this, url); },
                  get: function () { return this.getAttribute('src'); }
                });
              }
            }
            return element;
          };
          console.log("URL intercept hooks installed");
        });

        console.log("Successfully installed URL interception hooks and callback");

        // Click the button
        console.log(`Clicking button with selector: ${buttonSelector}`);
        await buttonHandle.click();
        console.log(`Clicked button with text: ${args.buttonText}`);

        // Wait for either the URL to be found or the timeout
        console.log(`Waiting up to ${waitTime}ms for target URL or timeout...`);
        const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), waitTime));
        const foundUrl = await Promise.race([urlFoundPromise, timeoutPromise]);

        // Clean up the exposed function to avoid memory leaks
        await page.exposeFunction('__reportUrlFound__', () => { }).catch(() => { }); // Overwrite with empty function

        // --- Handle results ---
        if (foundUrl) {
          // URL was reported back via the callback
          console.log(`Returning URL found via callback: ${foundUrl}`);
          return {
            content: [{ type: "text", text: foundUrl }],
            isError: false,
          };
        }

        // Timeout occurred, check collected URLs as a fallback
        console.log("Timeout reached. Checking collected URLs as fallback...");
        const interceptResult = await page.evaluate(() => {
          return {
            urls: (window as any).__interceptedUrls || [],
            lastUrl: (window as any).__lastInterceptedUrl || null
          };
        });

        console.log(`Intercepted ${interceptResult.urls.length} URLs in total`);

        // Check for URLs in script tags (as fallback)
        const jsURLs = await page.evaluate(() => {
          const scriptUrls: string[] = [];
          document.querySelectorAll('script').forEach(script => {
            if (script.textContent) {
              const pdfMatches = script.textContent.match(/(['"])(https?:\/\/[^'"]*\.pdf[^'"]*)\1/g);
              if (pdfMatches) { pdfMatches.forEach(m => scriptUrls.push(m.slice(1, -1))); }
              const windowOpenMatches = script.textContent.match(/window\.open\(['"]([^'"]+)['"]/g);
              if (windowOpenMatches) { windowOpenMatches.forEach(m => { const u = m.match(/\(['"]([^'"]+)['"]/)?.[1]; if (u) scriptUrls.push(u); }); }
            }
          });
          return scriptUrls;
        });

        // Combine and filter fallback URLs
        const allPotentialUrls = [
          ...interceptResult.urls.map((item: any) => item.url),
          ...jsURLs
        ].filter(Boolean);

        const targetUrls = allPotentialUrls.filter(url =>
          url && (
            url.toLowerCase().endsWith('.pdf') ||
            url.toLowerCase().includes('.pdf?') ||
            url.toLowerCase().includes('/pdf/') ||
            url.toLowerCase().includes('/download/') ||
            url.toLowerCase().includes('/report/') ||
            url.toLowerCase().includes('/generate/') ||
            url.toLowerCase().includes('blob:')
          )
        );

        if (targetUrls.length > 0) {
          const extractedUrl = targetUrls[targetUrls.length - 1];
          console.log(`Returning extracted URL found during fallback check: ${extractedUrl}`);
          return {
            content: [{ type: "text", text: extractedUrl }],
            isError: false,
          };
        }

        // Fallback to last intercepted URL if any
        const lastInterceptedUrl = interceptResult.lastUrl;
        if (lastInterceptedUrl) {
          console.log(`No specific target URL found, returning last intercepted URL: ${lastInterceptedUrl}`);
          return {
            content: [{ type: "text", text: lastInterceptedUrl }],
            isError: false,
          };
        }

        console.log("No relevant URLs were intercepted.");
        return {
          content: [{
            type: "text",
            text: `No URL was intercepted after clicking "${args.buttonText}". Timeout occurred.`,
          }],
          isError: true,
        };
      } catch (error) {
        // Make sure to clean up exposed function on error too
        await page.exposeFunction('__reportUrlFound__', () => { }).catch(() => { });
        return {
          content: [{
            type: "text",
            text: `Error during URL extraction: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    case ToolName.BrowserClickAndDownloadAuthenticated: {
      try {
        const waitTime = args.waitTime || 30000;
        const selector = args.selector || 'button, a, input[type=button], input[type=submit]'; // Broader default selector
        const buttonSelector = `${selector}:has-text("${args.buttonText}")`;

        console.log(`Looking for download button with selector: ${buttonSelector}`);

        // Prepare to capture the download event ON THE CURRENT PAGE
        const downloadPromise = page.waitForEvent('download', { timeout: waitTime });

        // Click the button ON THE CURRENT PAGE
        console.log(`Clicking button with selector: ${buttonSelector}`);
        try {
          await page.locator(buttonSelector).click();
          console.log(`Clicked button with text: ${args.buttonText}`);
        } catch (error) {
          if ((error as Error).message.includes("strict mode violation")) {
            console.log("Strict mode violation, retrying on first element...");
            await page.locator(buttonSelector).first().click();
            console.log(`Clicked first button with text: ${args.buttonText}`);
          } else {
            throw error;
          }
        }

        // Wait for the download to start
        console.log(`Waiting up to ${waitTime}ms for download to start...`);
        const download = await downloadPromise;

        console.log(`Download started: ${download.suggestedFilename()}`);

        // Save the downloaded file to a temporary path
        const tempPath = await download.path();
        if (!tempPath) {
          throw new Error("Download failed: Playwright did not provide a temporary path.");
        }
        console.log(`Download saved temporarily to: ${tempPath}`);

        // Read the file content
        const fileBuffer = await fs.readFile(tempPath);

        // Get original filename to extract extension
        const suggestedName = download.suggestedFilename();
        const extension = path.extname(suggestedName) || '.unknown'; // Get file extension or default
        console.log(`Downloaded ${suggestedName}, detected extension: ${extension}`);

        // Generate filename based on current date
        const now = new Date();
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const formattedDate = `eps_${months[now.getMonth()]}_${now.getDate()}_${now.getFullYear()}`;
        const autoFileName = `${formattedDate}${extension}`;

        // Determine the save path in the user's Downloads folder
        const downloadsPath = '/app/Downloads';
        const finalSavePath = path.join(downloadsPath, autoFileName); // Use the auto-generated file name

        // Ensure Downloads directory exists (create if not)
        await fs.mkdir(downloadsPath, { recursive: true });

        // Write the file buffer to the final destination
        await fs.writeFile(finalSavePath, fileBuffer);
        console.log(`File saved successfully to: ${finalSavePath}`);

        // Clean up the temporary file
        await fs.unlink(tempPath).catch(err => console.error(`Failed to delete temp file ${tempPath}: ${err}`));

        // Return success message with the generated filename
        return {
          content: [
            {
              type: "text",
              text: `File successfully saved to ${finalSavePath}` // Indicate save path
            }
          ],
          isError: false,
        };

      } catch (error) {
        // Handle potential timeout error specifically
        if ((error as Error).message.includes('Timeout')) {
          console.error(`Download timeout: No download event received within ${args.waitTime || 30000}ms`);
          return {
            content: [{
              type: "text",
              text: `Failed to download: No download started within the time limit after clicking "${args.buttonText}".`,
            }],
            isError: true,
          };
        }
        // Handle other errors
        console.error(`Error during authenticated download: ${(error as Error).message}`);
        return {
          content: [{
            type: "text",
            text: `Error during download: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{
          type: "text",
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
  }
}

// Add a file type mapping to store correct MIME types
const fileTypeMappings = new Map<string, string>();

const server = new Server(
  {
    name: "automatalabs/playwright",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// Setup request handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "console://logs",
      mimeType: "text/plain",
      name: "Browser console logs",
    },
    ...Array.from(screenshots.keys()).map(name => ({
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri.toString();

  if (uri === "console://logs") {
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: consoleLogs.join("\n"),
      }],
    };
  }

  if (uri.startsWith("screenshot://")) {
    const name = uri.split("://")[1];
    const screenshot = screenshots.get(name);
    if (screenshot) {
      // Check for custom mime type mapping
      const mimeType = fileTypeMappings.get(name) ||
        (name.toLowerCase().endsWith('.pdf') ? "application/pdf" : "image/png");

      return {
        contents: [{
          uri,
          mimeType,
          blob: screenshot,
        }],
      };
    }
  }

  throw new Error(`Resource not found: ${uri}`);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name as ToolName, request.params.arguments ?? {})
  );
}

async function checkPlatformAndInstall() {
  const platform = os.platform();
  if (platform === "win32") {
    console.log("Installing MCP Playwright Server for Windows...");
    try {
      const configFilePath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');

      let config: any;
      try {
        // Try to read existing config file
        const fileContent = await fs.readFile(configFilePath, 'utf-8');
        config = JSON.parse(fileContent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Create new config file with mcpServers object
          config = { mcpServers: {} };
          await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
          console.log("Created new Claude config file");
        } else {
          console.error("Error reading Claude config file:", error);
          process.exit(1);
        }
      }

      // Ensure mcpServers exists
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Update the playwright configuration
      config.mcpServers.playwright = {
        command: "npx",
        args: ["-y", "@automatalabs/mcp-server-playwright"]
      };

      // Write the updated config back to file
      await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
      console.log("✓ Successfully updated Claude configuration");

    } catch (error) {
      console.error("Error during installation:", error);
      process.exit(1);
    }
  } else if (platform === "darwin") {
    console.log("Installing MCP Playwright Server for macOS...");
    try {
      const configFilePath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

      let config: any;
      try {
        // Try to read existing config file
        const fileContent = await fs.readFile(configFilePath, 'utf-8');
        config = JSON.parse(fileContent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Create new config file with mcpServers object
          config = { mcpServers: {} };
          await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
          console.log("Created new Claude config file");
        } else {
          console.error("Error reading Claude config file:", error);
          process.exit(1);
        }
      }

      // Ensure mcpServers exists
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Update the playwright configuration
      config.mcpServers.playwright = {
        command: "npx",
        args: ["-y", "@automatalabs/mcp-server-playwright"]
      };

      // Write the updated config back to file
      await fs.writeFile(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
      console.log("✓ Successfully updated Claude configuration");

    } catch (error) {
      console.error("Error during installation:", error);
      process.exit(1);
    }
  } else {
    console.error("Unsupported platform:", platform);
    process.exit(1);
  }
}

(async () => {
  try {
    // Parse args but continue with server if no command specified
    await yargs(hideBin(process.argv))
      .command('install', 'Install MCP-Server-Playwright dependencies', () => { }, async () => {
        await checkPlatformAndInstall();
        // Exit after successful installation
        process.exit(0);
      })
      .strict()
      .help()
      .parse();

    // If we get here, no command was specified, so run the server
    await runServer().catch(console.error);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
