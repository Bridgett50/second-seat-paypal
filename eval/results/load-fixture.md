# Load test (fixture mode, not production)

Mode: fixture only, localhost, no network. Server: dist-server.

HTTP GET /briefs/demo x500 @concurrency 20: failed=0 p50=106.6ms p90=116.3ms max=1245ms

brief fixture pipeline x20 (hero): failed=0 p50=1.4ms p90=4.2ms max=8.9ms

These numbers measure local fixture replay only and say nothing about production.
