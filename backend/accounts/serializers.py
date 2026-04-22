import re

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from rest_framework import serializers

from accounts.models import Profile


TELEGRAM_RE = re.compile(r'^[a-zA-Z0-9_]{5,32}$')


def normalize_telegram(raw: str) -> str:
    if raw is None:
        return ''
    t = raw.strip()
    if t.startswith('https://t.me/'):
        t = t[len('https://t.me/'):]
    elif t.startswith('t.me/'):
        t = t[len('t.me/'):]
    if t.startswith('@'):
        t = t[1:]
    return t


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    telegram = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already taken.")
        return value

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("Email already registered.")
        return value

    def create(self, validated_data):
        telegram = validated_data.pop('telegram', '')
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
        )
        if telegram:
            user.profile.telegram = normalize_telegram(telegram)
            user.profile.save()
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        user = authenticate(username=data['username'], password=data['password'])
        if user is None:
            raise serializers.ValidationError("Invalid credentials.")
        data['user'] = user
        return data


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['telegram', 'phone', 'avatar']

    def validate_telegram(self, value):
        if value in (None, ''):
            return ''
        normalized = normalize_telegram(value)
        if not TELEGRAM_RE.match(normalized):
            raise serializers.ValidationError(
                'Telegram handle must be 5-32 chars, letters/digits/underscore only.'
            )
        return normalized
