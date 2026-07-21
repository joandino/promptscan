// Generic .invoke() with no LangChain binding must NOT be flagged.
export function handle(emitter: any, lambda: any) {
  emitter.invoke("event");
  lambda.stream({ payload: 1 });
}
