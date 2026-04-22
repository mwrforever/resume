"""
User Auth API Tests

Tests for:
- POST /api/v1/user/auth/send-code
- POST /api/v1/user/auth/register
- POST /api/v1/user/auth/login
- POST /api/v1/user/auth/refresh
"""
import pytest
import time


class TestUserSendCode:
    """Tests for POST /api/v1/user/auth/send-code"""

    @pytest.mark.asyncio
    async def test_send_code_returns_200_and_stores_in_redis(self, client, unique_email, redis_client):
        """Send code should return 200 and store code in Redis."""
        response = await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["code"] == 200
        assert data["message"] == "验证码已发送"

        # Verify code is stored in Redis
        key = f"verify_code:{unique_email}:user"
        stored_code = redis_client.get(key)
        assert stored_code is not None
        assert len(stored_code) == 6
        assert stored_code.isdigit()

    @pytest.mark.asyncio
    async def test_send_code_rejects_rapid_repeat(self, client, unique_email, redis_client):
        """Send code should reject rapid repeat requests (60s cooldown)."""
        # First request should succeed
        response1 = await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        assert response1.status_code == 200

        # Second request within cooldown should fail
        response2 = await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        assert response2.status_code == 429
        data = response2.json()
        assert "发送太频繁" in data["detail"]


class TestUserRegister:
    """Tests for POST /api/v1/user/auth/register"""

    @pytest.mark.asyncio
    async def test_register_creates_user_and_returns_token(self, client, unique_email, redis_client):
        """Register should create user and return tokens."""
        # First send code to get valid verification
        send_response = await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        assert send_response.status_code == 200

        # Get the code from Redis
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        # Register with valid code
        response = await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["user_type"] == "user"

    @pytest.mark.asyncio
    async def test_register_validates_verification_code(self, client, unique_email):
        """Register should reject invalid verification code."""
        response = await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": "000000",
                "real_name": "Test User"
            }
        )
        assert response.status_code == 400
        data = response.json()
        assert "验证码错误" in data["detail"]

    @pytest.mark.asyncio
    async def test_register_prevents_duplicate_email(self, client, unique_email, redis_client):
        """Register should prevent duplicate email registration."""
        # First send code and register
        await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )

        # Try to register again with same email (need to wait for cooldown)
        import asyncio
        await asyncio.sleep(61)
        response2 = await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        code2 = redis_client.get(key)

        response = await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code2,
                "real_name": "Another User"
            }
        )
        assert response.status_code == 400
        assert "邮箱已被注册" in response.json()["detail"]


class TestUserLogin:
    """Tests for POST /api/v1/user/auth/login"""

    @pytest.mark.asyncio
    async def test_login_with_password_returns_token(self, client, unique_email, redis_client):
        """Login with password should return tokens when credentials are valid."""
        # First register
        await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )

        # Login with password
        response = await client.post(
            "/api/v1/user/auth/login",
            json={
                "identifier": unique_email,
                "login_type": "password",
                "password": "TestPassword123"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["user_type"] == "user"

    @pytest.mark.asyncio
    async def test_login_with_password_rejects_wrong_password(self, client, unique_email, redis_client):
        """Login with password should reject wrong password."""
        # First register
        await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )

        # Login with wrong password
        response = await client.post(
            "/api/v1/user/auth/login",
            json={
                "identifier": unique_email,
                "login_type": "password",
                "password": "WrongPassword123"
            }
        )
        assert response.status_code == 401
        assert "错误" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_login_with_code_returns_token_when_code_valid(self, client, unique_email, redis_client):
        """Login with code should return token when code is valid."""
        # First register
        await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )

        # Send new code for login (directly set to bypass cooldown for testing)
        login_code = "999999"
        redis_client.setex(key, 300, login_code)

        # Login with code
        response = await client.post(
            "/api/v1/user/auth/login",
            json={
                "identifier": unique_email,
                "login_type": "code",
                "code": login_code
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data

    @pytest.mark.asyncio
    async def test_login_with_code_rejects_wrong_code(self, client, unique_email, redis_client):
        """Login with code should reject wrong code."""
        # First register
        await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )

        # Login with wrong code
        response = await client.post(
            "/api/v1/user/auth/login",
            json={
                "identifier": unique_email,
                "login_type": "code",
                "code": "000000"
            }
        )
        assert response.status_code == 400
        assert "验证码错误" in response.json()["detail"]


class TestUserRefresh:
    """Tests for POST /api/v1/user/auth/refresh"""

    @pytest.mark.asyncio
    async def test_refresh_renews_access_token(self, client, unique_email, redis_client):
        """Refresh should issue new tokens when refresh token is valid."""
        # First register
        await client.post(
            "/api/v1/user/auth/send-code",
            json={"email": unique_email, "user_type": "user"}
        )
        key = f"verify_code:{unique_email}:user"
        code = redis_client.get(key)

        register_response = await client.post(
            "/api/v1/user/auth/register",
            json={
                "email": unique_email,
                "password": "TestPassword123",
                "code": code,
                "real_name": "Test User"
            }
        )
        refresh_token = register_response.json()["refresh_token"]
        original_access_token = register_response.json()["access_token"]

        # Wait a moment to ensure token timestamps differ
        time.sleep(1)

        # Refresh tokens
        response = await client.post(
            "/api/v1/user/auth/refresh",
            json={"refresh_token": refresh_token}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["code"] == 200
        assert "access_token" in data["data"]
        assert "refresh_token" in data["data"]
        # New access token should be different
        assert data["data"]["access_token"] != original_access_token
