import asyncio, discord, sys

TOKEN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TOKEN")
GUILD_ID = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("GUILD_ID")

async def main():
    client = discord.Client(intents=discord.Intents.default())
    ready = asyncio.Event()

    @client.event
    async def on_ready():
        print(f"✅ Bot online: {client.user}")
        if client.guilds:
            for g in client.guilds:
                print(f"   In server: {g.name} (ID: {g.id})")
        else:
            print("❌ Bot is NOT in any server. Open the invite URL.")
        ready.set()
        await client.close()

    await asyncio.wait_for(client.start(TOKEN), timeout=15)
    await ready.wait()

asyncio.run(main())
