# Google OAuth Setup

This guide configures Google sign-in for the Flask app in `auth.py`.

### Install dependencies:
```
cd backend
python -m pip install -r requirements.txt
```

## 1. Create or select a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select the project that owns the `Documind-Web` OAuth client, or create a new project.
3. Open **APIs & Services > OAuth consent screen**.
4. Configure the app name and support email.
5. Add your Google account as a test user while the app is in testing mode.

## 2. Create the OAuth client

1. Open **APIs & Services > Credentials**.
2. Select **Create credentials > OAuth client ID**.
3. Choose **Web application**.
4. Add this under **Authorized JavaScript origins**:

   ```text
   http://localhost:8000
   ```

5. Add this under **Authorized redirect URIs**:

   ```text
   http://localhost:8000/auth/callback
   ```

6. Create the client.
7. Open the client details and copy the **Client ID** and **Client secret**.

Do not put `/auth/callback` in Authorized JavaScript origins. Paths belong only in Authorized redirect URIs.

## 3. Fill in `backend/.env`

Use the values from the OAuth client details:

```env
FLASK_SECRET_KEY=generate-a-long-random-value
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-real-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/callback
```

`FLASK_SECRET_KEY` is used to protect Flask sessions. Generate one locally with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Do not add quotes unless they are part of the value. Do not share or commit `.env`.

## 4. Start the backend

From the backend directory:

```bash
cd backend
python auth.py
```

The server listens on `http://localhost:8000`.

Open this URL to begin sign-in:

```text
http://localhost:8000/login
```

## 5. Troubleshooting

### `invalid_client`

The client secret is incorrect, expired, copied from a different OAuth client, or still a placeholder. Copy the secret from the same client whose ID is in `.env`.

### `redirect_uri_mismatch`

The redirect URI in Google Cloud must exactly match:

```text
http://localhost:8000/auth/callback
```

The scheme, host, port, path, and trailing slash must match.

### `Invalid origin`

Use only this value for the JavaScript origin:

```text
http://localhost:8000
```

Origins cannot contain a path or end with `/`.

### Testing with `127.0.0.1`

Use one hostname consistently. If you change the app to use `127.0.0.1`, register this separate redirect URI in Google Cloud:

```text
http://127.0.0.1:8000/auth/callback
```
