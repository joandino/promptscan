# `.invoke` / `.stream` on non-LangChain objects must NOT be flagged.
def run(worker, db):
    worker.invoke("run the nightly job")
    for row in db.stream("SELECT * FROM t"):
        print(row)
