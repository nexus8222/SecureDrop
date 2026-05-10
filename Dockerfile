FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000 9001 45678/udp
CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000", "--tcp-port", "9001"]
