import os
from flask import Flask, redirect, render_template, url_for, session, jsonify, request
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-me")


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    allowed_origins = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

oauth = OAuth(app)
oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@app.route("/")
def index():
    return jsonify({"message": "Demo backend is running"})


@app.route("/account")
def account():
    user = session.get("user")
    if user:
        return f"""
            <h2>Signed in as {user['name']} ({user['email']})</h2>
            <img src="{user.get('picture', '')}" width="80" style="border-radius:50%">
            <p><a href="/logout">Sign out</a></p>
        """
    return '<h2>Not signed in</h2><p><a href="/login">Sign in with Google</a></p>'


@app.route("/health")
def health_check():
    return jsonify({"status": "ok"})


@app.route('/test', methods=['GET', 'POST'])
def test():
    if request.method == 'POST':
        name = request.form['username']
        return f"Hello {name}, POST request received"
    return render_template('name.html')



@app.route("/echo", methods=["POST"])
def echo_payload():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400
    return jsonify({"data": payload})


@app.route("/login")
def login():
    redirect_uri = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://localhost:8000/auth/callback",
    )
    return oauth.google.authorize_redirect(redirect_uri)


@app.route("/auth/callback")
def auth_callback():
    token = oauth.google.authorize_access_token()
    user_info = token.get("userinfo")   # already verified by Authlib

    session["user"] = {
        "sub": user_info["sub"],
        "email": user_info["email"],
        "email_verified": user_info.get("email_verified", False),
        "name": user_info.get("name"),
        "picture": user_info.get("picture"),
    }
    return redirect("/")


@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect("/")


@app.route("/whoami")
def whoami():
    return jsonify(session.get("user", {"error": "not signed in"}))


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)