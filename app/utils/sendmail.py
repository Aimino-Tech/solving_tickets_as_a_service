#!/usr/bin/env python3
"""Send email via IONOS SMTP (STARTTLS)."""
import smtplib, ssl, sys, uuid
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST = "smtp.ionos.de"
SMTP_PORT = 587

def send_email(from_addr, password, to_addr, subject, body):
    msg = MIMEMultipart("alternative")
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg["Message-ID"] = f"<{uuid.uuid4().hex}@syntaro.io>"

    msg.attach(MIMEText(body, "plain", "utf-8"))

    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls(context=ctx)
        server.login(from_addr, password)
        server.sendmail(from_addr, [to_addr], msg.as_string())
    print("Email sent successfully.")

if __name__ == "__main__":
    from_addr = sys.argv[1]
    password  = sys.argv[2]
    to_addr   = sys.argv[3]
    subject   = sys.argv[4]
    body      = sys.argv[5]
    send_email(from_addr, password, to_addr, subject, body)
