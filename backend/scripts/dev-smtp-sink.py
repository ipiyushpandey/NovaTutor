#!/usr/bin/env python3
"""Minimal SMTP sink for local end-to-end verification tests.

It speaks just enough SMTP for JavaMail (EHLO, MAIL, RCPT, DATA, QUIT),
writes each accepted message to a directory as .eml, and never forwards
anything. Use it only on 127.0.0.1 during development.

    python3 backend/scripts/dev-smtp-sink.py --port 1025 --out /tmp/nova-mail
"""
import argparse
import os
import socketserver
import sys
import time


class SMTPHandler(socketserver.StreamRequestHandler):
    def reply(self, text):
        self.wfile.write((text + "\r\n").encode("utf-8"))
        self.wfile.flush()

    def handle(self):
        self.reply("220 localhost NovaTutor test sink")
        mail_from = ""
        recipients = []
        while True:
            line = self.rfile.readline()
            if not line:
                return
            command = line.decode("utf-8", "replace").strip()
            upper = command.upper()
            if upper.startswith("EHLO") or upper.startswith("HELO"):
                self.reply("250-localhost")
                self.reply("250-8BITMIME")
                self.reply("250 SIZE 52428800")
            elif upper.startswith("MAIL FROM:"):
                mail_from = command[10:].strip()
                recipients = []
                self.reply("250 OK")
            elif upper.startswith("RCPT TO:"):
                recipients.append(command[8:].strip())
                self.reply("250 OK")
            elif upper == "DATA":
                self.reply("354 End data with <CR><LF>.<CR><LF>")
                chunks = []
                while True:
                    data_line = self.rfile.readline()
                    if not data_line or data_line in (b".\r\n", b".\n"):
                        break
                    if data_line.startswith(b".."):
                        data_line = data_line[1:]
                    chunks.append(data_line)
                out_dir = self.server.out_dir
                os.makedirs(out_dir, exist_ok=True)
                stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time()*1000)%1000:03d}"
                path = os.path.join(out_dir, f"{stamp}.eml")
                with open(path, "wb") as handle:
                    handle.write(b"X-Test-From: " + mail_from.encode() + b"\r\n")
                    handle.write(b"X-Test-To: " + ", ".join(recipients).encode() + b"\r\n")
                    handle.writelines(chunks)
                self.server.accepted.append(path)
                sys.stdout.write(f"accepted -> {path}\n")
                sys.stdout.flush()
                self.reply("250 Queued")
            elif upper == "RSET":
                self.reply("250 OK")
            elif upper == "NOOP":
                self.reply("250 OK")
            elif upper == "QUIT":
                self.reply("221 Bye")
                return
            else:
                self.reply("250 OK")


class Sink(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, out_dir):
        super().__init__(address, SMTPHandler)
        self.out_dir = out_dir
        self.accepted = []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=1025)
    parser.add_argument("--out", default="/tmp/nova-mail")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    with Sink(("127.0.0.1", args.port), args.out) as server:
        print(f"NovaTutor SMTP sink listening on 127.0.0.1:{args.port} -> {args.out}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
