/**
 * Module with functions used for AI formula assistance.
 */

import {delay} from 'app/common/delay';
import log from 'app/server/lib/log';
import fetch from 'node-fetch';

export const DEPS = { fetch };

export async function sendForCompletion(prompt: string): Promise<string> {
  let completion: string|null = null;
  let retries: number = 0;
  const openApiKey = process.env.OPENAI_API_KEY;
  const model = process.env.COMPLETION_MODEL || "text-davinci-002";

  while(retries++ < 3) {
    console.log("TRY", {retries});
    try {
      if (openApiKey) {
        completion = await sendForCompletionOpenAI(prompt, openApiKey, model);
      }
      if (process.env.HUGGINGFACE_API_KEY) {
        completion = await sendForCompletionHuggingFace(prompt);
      }
      break;
    } catch(e) {
      await delay(1000);
    }
  }
  if (completion === null) {
    throw new Error("Please set OPENAI_API_KEY or HUGGINGFACE_API_KEY (and optionally COMPLETION_MODEL)");
  }
  log.debug(`Received completion:`, {completion});
  let rcompletion = completion.split(/\n {4}[^ ]/)[0];
  if (rcompletion === '') {
    rcompletion = completion;
  }
  return rcompletion;
}


async function sendForCompletionOpenAI(prompt: string, apiKey: string, model = "text-davinci-002") {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }
  const chatMode = model.includes('turbo');
  const endpoint = `https://api.openai.com/v1/${chatMode ? 'chat/' : ''}completions`;
  console.log({
    chatMode,
    model,
    endpoint,
  });
  //process.exit(1);
    
  const response = await DEPS.fetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(!chatMode ? {
          prompt,
        } : {
          messages: [
            {role: 'system', content: 'The user gives you one or more Python classes, with one last method that needs completing. Write the method body as a single code block, including the docstring the user gave. Just give the Python code as a markdown block, do not give any introduction, that will just be awkward for the user when copying and pasting. You are working with Grist, an environment very like regular Python except `rec` (like record) is used instead of `self`. Include at least one `return` statement or the method will fail, disappointing the user. Your answer should be the body of a single method, not a class, and should not include `dataclass` or `class` since the user is counting on you to provide a single method. Thanks!'},
            {role: 'user', content: prompt},
          ],
        }),
        max_tokens: 150,
        temperature: 0,
        // COMPLETION_MODEL of `code-davinci-002` may be better if you have access to it.
        model,
        stop: ["\n\n"],
      }),
    },
  );
  if (response.status !== 200) {
    log.error(`OpenAI API returned ${response.status}: ${await response.text()}`);
    throw new Error(`OpenAI API returned status ${response.status}`);
  }
  const result = await response.json();
  console.log("RESULT", JSON.stringify(result));
  let completion: string = String(chatMode ? result.choices[0].message.content : result.choices[0].text);
  if (chatMode) {
    const lines = completion.split('\n');
    if (lines[0].startsWith('```')) {
      lines.shift();
      lines.pop();
    }
    completion = lines.join('\n');
    while (completion.includes('"""')) {
      const parts = completion.split('"""')
      completion = parts[parts.length - 1];
      console.log("parts", {parts});
    }
    console.log("REAL RESULT", {completion});
  }
  return completion;
}

async function sendForCompletionHuggingFace(prompt: string) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error("HUGGINGFACE_API_KEY not set");
  }
  // COMPLETION_MODEL values I've tried:
  //   - codeparrot/codeparrot
  //   - NinedayWang/PolyCoder-2.7B
  //   - NovelAI/genji-python-6B
  let completionUrl = process.env.COMPLETION_URL;
  if (!completionUrl) {
    if (process.env.COMPLETION_MODEL) {
      completionUrl = `https://api-inference.huggingface.co/models/${process.env.COMPLETION_MODEL}`;
    } else {
      completionUrl = 'https://api-inference.huggingface.co/models/NovelAI/genji-python-6B';
    }
  }

  const response = await DEPS.fetch(
    completionUrl,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          return_full_text: false,
          max_new_tokens: 50,
        },
      }),
    },
  );
  if (response.status === 503) {
    log.error(`Sleeping for 10s - HuggingFace API returned ${response.status}: ${await response.text()}`);
    await delay(10000);
  }
  if (response.status !== 200) {
    const text = await response.text();
    log.error(`HuggingFace API returned ${response.status}: ${text}`);
    throw new Error(`HuggingFace API returned status ${response.status}: ${text}`);
  }
  const result = await response.json();
  const completion = result[0].generated_text;
  return completion.split('\n\n')[0];
}
