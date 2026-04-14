#!/usr/bin/env python3
"""Test script for RAG chatbot - queries MCP and validates response."""
import sys
import json
import time

try:
    from urllib.request import Request, urlopen
    from urllib.error import URLError, HTTPError
except ImportError:
    print("ERROR: Python 3 urllib required")
    sys.exit(1)

API_BASE = "http://127.0.0.1:8000"
MAX_WAIT = 60  # seconds to wait for server


def wait_for_server():
    """Wait for server to be ready."""
    for i in range(MAX_WAIT):
        try:
            urlopen(f"{API_BASE}/api/courses", timeout=2)
            return True
        except (URLError, ConnectionRefusedError, OSError):
            time.sleep(1)
    return False


def test_query_mcp():
    """Test POST /api/query with 'MCP' query."""
    print("=== Test 1: POST /api/query (MCP) ===")
    data = json.dumps({"query": "MCP"}).encode()
    req = Request(f"{API_BASE}/api/query", data=data, headers={"Content-Type": "application/json"})
    try:
        resp = urlopen(req, timeout=60)
        result = json.loads(resp.read())
        answer = result.get("answer", "")
        sources = result.get("sources", [])
        if not answer:
            print(f"FAIL: Empty answer")
            return False
        if not sources:
            print(f"WARN: No sources returned")
        print(f"PASS: Got answer ({len(answer)} chars, {len(sources)} sources)")
        print(f"  Preview: {answer[:150]}...")
        return True
    except HTTPError as e:
        print(f"FAIL: HTTP {e.code} - {e.read().decode()}")
        return False
    except URLError as e:
        print(f"FAIL: Connection error - {e.reason}")
        return False


def test_stream_mcp():
    """Test POST /api/query/stream with 'MCP' query."""
    print("\n=== Test 2: POST /api/query/stream (MCP) ===")
    data = json.dumps({"query": "MCP"}).encode()
    req = Request(f"{API_BASE}/api/query/stream", data=data, headers={"Content-Type": "application/json"})
    try:
        resp = urlopen(req, timeout=60)
        content = resp.read().decode()
        lines = content.strip().split("\n")
        events = []
        for line in lines:
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))

        if not events:
            print("FAIL: No SSE events received")
            return False

        types = [e["type"] for e in events]
        print(f"PASS: Got {len(events)} SSE events: {types}")

        # Check for error event
        for e in events:
            if e["type"] == "error":
                print(f"FAIL: Error event: {e['data']}")
                return False

        # Check we got some content
        text_events = [e for e in events if e["type"] in ("token", "full")]
        if not text_events:
            print("FAIL: No text content events")
            return False

        full_text = "".join(e["data"] for e in events if e["type"] == "token")
        if not full_text and events and events[-1].get("type") == "full":
            full_text = events[-2].get("data", "") if len(events) > 1 else ""

        # Check done event has sources
        done_events = [e for e in events if e["type"] == "done"]
        if done_events:
            sources = done_events[0].get("data", {}).get("sources", [])
            print(f"  Sources: {len(sources)}")
            print(f"  Preview: {full_text[:150]}...")

        return True
    except HTTPError as e:
        print(f"FAIL: HTTP {e.code} - {e.read().decode()}")
        return False
    except URLError as e:
        print(f"FAIL: Connection error - {e.reason}")
        return False


if __name__ == "__main__":
    print("Waiting for server...")
    if not wait_for_server():
        print("FAIL: Server not reachable after 60s")
        sys.exit(1)
    print("Server ready.\n")

    results = []
    results.append(test_query_mcp())
    results.append(test_stream_mcp())

    print(f"\n{'='*50}")
    passed = sum(results)
    total = len(results)
    print(f"Results: {passed}/{total} tests passed")
    if passed == total:
        print("All tests PASSED!")
        sys.exit(0)
    else:
        print("Some tests FAILED")
        sys.exit(1)