plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "com.gamesforfun.mobsmith"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.gamesforfun.mobsmith"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"
    }

    // A shared, non-secret signing key is committed so every build of the APK
    // can install over the previous one. It is NOT meant for a store release.
    signingConfigs {
        create("shared") {
            storeFile = file("mobsmith-shared.keystore")
            storePassword = "mobsmith"
            keyAlias = "mobsmith"
            keyPassword = "mobsmith"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("shared")
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

// The web UI is prebuilt into src/main/assets/www (see web/README.md).
// Rebuild it with:  cd addonmaker/web && npm install && npm run build
