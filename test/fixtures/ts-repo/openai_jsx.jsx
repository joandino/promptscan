import OpenAI from "openai";
const client = new OpenAI();
export function App() {
  client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi from jsx" }] });
  return <div className="app">hi</div>;
}
