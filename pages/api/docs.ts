import { supabaseClient } from "@/lib/embeddings-supabase";
import { OpenAIStream, OpenAIStreamPayload } from "@/utils/OpenAIStream";
import { oneLine, stripIndent } from "common-tags";
import GPT3Tokenizer from "gpt3-tokenizer";
import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type"
};

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing env var from OpenAI");
}

export const config = {
  runtime: "edge"
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    console.log("req.method ", req.method);
    return new Response("ok", { headers: corsHeaders });
  }

  const { question } = (await req.json()) as {
    question?: string;
  };

  if (!question) {
    return new Response("No prompt in the request", { status: 400 });
  }

  const query = question;

  // OpenAI recommends replacing newlines with spaces for best results
  const input = query.replace(/\n/g, " ");
  // console.log("input: ", input);

  const apiKey = process.env.OPENAI_API_KEY;

  const embeddingResponse = await fetch(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input,
        model: "text-embedding-ada-002"
      })
    }
  );

  const embeddingData = await embeddingResponse.json();
  const [{ embedding }] = embeddingData.data;
  // console.log("embedding: ", embedding);

  const { data: documents, error } = await supabaseClient.rpc(
    "match_documents",
    {
      query_embedding: embedding,
      similarity_threshold: 0.1, // Choose an appropriate threshold for your data
      match_count: 10 // Choose the number of matches
    }
  );

  if (error) console.error(error);

  const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
  let tokenCount = 0;
  let contextText = "";

  // console.log("documents: ", documents);

  // Concat matched documents
  if (documents) {
    for (let i = 0; i < documents.length; i++) {
      const document = documents[i];
      const content = document.content;
      const url = document.url;
      const encoded = tokenizer.encode(content);
      tokenCount += encoded.text.length;

      // Limit context to max 1500 tokens (configurable)
      if (tokenCount > 1500) {
        break;
      }

      contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`;
    }
  }

  // console.log("contextText: ", contextText);

  const systemContent = `You are a helpful assistant. When given CONTEXT you answer questions using only that information,
  and you always format your output in markdown. If you can't find the answer in the given CONTEXT, you may use your general knowledge to answer the question.
  - dont apologize if the answer is not explicitly written in the CONTEXT provided.
  - ignore casing and punctuation if it's missing from the question.
  - you are an expert home inspector assisting a home inspector in the field.
  - you can answer questions about how to perform home inspections and construction techniques.
  - you can provide definitions and meanings in the domain of home inspections and residential construction techniques and practices.
  - you are a master home inspector, up to date on all the latest building codes and standards.
  - you have a background in engineering, construction, and home inspections for real estate transactions.
  - you only answer questions within your knowledge domain.
  - you are a good teacher and communicator.
  - you are accurate, concise and pithy.
  - always provide numeric step-by-step instructions to how to questions.
  - you are a bot, but you are a very good bot.
  - interpret the users question, to the letter. 
  - output the users query at the beginning of your response.
  - break up text into paragraphs for readability. 
  - outputs containing a : or a - are considered to be lists.
  - you practice non-invasive home inspections, as such, you will not instruct users to perform actions such as "turn off the gas cock" or "turn off the main power to inspect" or "clean etc" that could lead to unexpected results or damage to the properties systems, you only provide visual inspection advice.
  - Provide factual answers to questions.
  - feel free ask questions to get closer to a better answer.
  - Minimize any other prose.
  `;

  const userContent = `CONTEXT:
  Next.js is a React framework for creating production-ready web applications. It provides a variety of methods for fetching data, a built-in router, and a Next.js Compiler for transforming and minifying JavaScript code. It also includes a built-in Image Component and Automatic Image Optimization for resizing, optimizing, and serving images in modern formats.
  SOURCE: nextjs.org/docs/faq
  
  QUESTION: 
  what is nextjs?    
  `;

  const assistantContent = `What is NextJS?\n\nNext.js is a framework for building production-ready web applications using React. It offers various data fetching options, comes equipped with an integrated router, and features a Next.js compiler for transforming and minifying JavaScript. Additionally, it has an inbuilt Image Component and Automatic Image Optimization that helps resize, optimize, and deliver images in modern formats.
  
  \`\`\`js
  function HomePage() {
    return <div>Welcome to Next.js!</div>
  }
  
  export default HomePage
  \`\`\`
  
  SOURCES:
  https://nextjs.org/docs/faq`;

  const userMessage = `CONTEXT:
  ${contextText}
  
  USER QUESTION: 
  ${query}  
  `;

  const messages = [
    {
      role: "system",
      content: systemContent
    },
    {
      role: "user",
      content: userContent
    },
    {
      role: "assistant",
      content: assistantContent
    },
    {
      role: "user",
      content: userMessage
    }
  ];


  console.log("messages: ", messages);

  const payload: OpenAIStreamPayload = {
    model: "gpt-3.5-turbo-0301",
    messages: messages,
    temperature: 0,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 2000,
    stream: true,
    n: 1
  };

  const stream = await OpenAIStream(payload);
  return new Response(stream);
};

export default handler;
