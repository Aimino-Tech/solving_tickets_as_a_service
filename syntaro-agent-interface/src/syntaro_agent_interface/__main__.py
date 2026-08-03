import argparse, asyncio, logging, os, sys
from syntaro_agent_interface.mcp_server import run_server
def main():
    p = argparse.ArgumentParser(description="SYNTARO Agent Interface MCP Server")
    p.add_argument("--mode", choices=["stdio","http"], default=os.getenv("SYNTARO_MCP_MODE","http"))
    p.add_argument("--port", type=int, default=int(os.getenv("SYNTARO_MCP_PORT","4094")))
    p.add_argument("--host", default=os.getenv("SYNTARO_MCP_HOST","0.0.0.0"))
    p.add_argument("--no-auth", action="store_true")
    p.add_argument("--log-level", default=os.getenv("SYNTARO_LOG_LEVEL","INFO"), choices=["DEBUG","INFO","WARNING","ERROR"])
    a = p.parse_args()
    logging.basicConfig(level=getattr(logging,a.log_level.upper()), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s", stream=sys.stderr)
    asyncio.run(run_server(mode=a.mode, port=a.port, host=a.host, require_auth=not a.no_auth))
if __name__ == "__main__": main()
