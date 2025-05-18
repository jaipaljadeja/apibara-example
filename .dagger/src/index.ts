/**
 * A generated module for ApibaraDagger functions
 *
 * This module has been generated via dagger init and serves as a reference to
 * basic module structure as you get started with Dagger.
 *
 * Two functions have been pre-created. You can modify, delete, or add to them,
 * as needed. They demonstrate usage of arguments and return types using simple
 * echo and grep commands. The functions can be called from the dagger CLI or
 * from one of the SDKs.
 *
 * The first line in this comment block is a short description line and the
 * rest is a long description with more detail on the module's purpose or usage,
 * if appropriate. All modules should have a short description.
 */
import {
  type Container,
  type Directory,
  type Secret,
  dag,
  func,
  object,
} from "@dagger.io/dagger";
import axios from "axios";

// Dockerfile content from the original main.ts
const dockerFileCode = `
FROM node:22-alpine AS base

# Set up PNPM and corepack
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

# Add libc6-compat for native package compatibility
RUN apk update
RUN apk add --no-cache libc6-compat

# -------- Dependencies Installer --------
FROM base AS installer

WORKDIR /app

# Copy only dependency declarations first
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the project
COPY . .

# Build the Apibara project
RUN pnpm apibara build

# -------- Final Runtime Image --------
FROM base AS runner

ENV NODE_ENV=production
WORKDIR /app

# Copy dependencies and necessary files
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/package.json ./package.json
COPY --from=installer /app/.apibara ./.apibara
COPY --from=installer /app/drizzle ./drizzle


# Set working dir to where start.mjs lives
WORKDIR /app

# Start the indexer
ENTRYPOINT ["node", ".apibara/build/start.mjs"]
`;
const PROJECT_INFO_FILE_PATH = ".apibara/project-info.json";

@object()
export class Apibara {
  /**
   * Returns a container that echoes whatever string argument is provided
   */
  @func()
  containerEcho(stringArg: string): Container {
    return dag.container().from("alpine:latest").withExec(["echo", stringArg]);
  }

  /**
   * Fetches the source code from the specified Git repository and branch.
   * @param githubRepo The URL of the GitHub repository.
   * @param branch The branch to clone. Defaults to "main".
   * @returns A Directory object representing the fetched source code.
   */
  @func()
  private getSource(githubRepo: string, branch = "main"): Directory {
    const source = dag.git(githubRepo).branch(branch).tree();
    return source;
  }

  /**
   * Sets up a base Node.js container with source code mounted and corepack enabled.
   * @param source The Directory object representing the source code.
   * @param targetDirectory Optional subdirectory within the source code where the project resides.
   * @returns A Container object pre-configured with Node.js, source code, and corepack.
   */
  @func()
  private getBaseContainer(
    source: Directory,
    targetDirectory?: string,
  ): Container {
    const workDir = targetDirectory ? `/src/${targetDirectory}` : "/src";
    const baseContainer = dag
      .container()
      .from("node:22-alpine")
      .withDirectory("/src", source)
      .withWorkdir(workDir)
      .withExec(["corepack", "enable"]);
    return baseContainer;
  }

  /**
   * Builds the Apibara project by installing dependencies and running the build command.
   * @param githubRepo The URL of the GitHub repository.
   * @param branch The branch to clone.
   * @param packageManager The package manager to use ("pnpm" or "npm").
   * @param targetDirectory Optional subdirectory where the project resides.
   * @returns A Container object with the project built.
   */
  @func()
  buildProject(
    githubRepo: string,
    branch: string,
    packageManager: string,
    targetDirectory?: string,
  ): Container {
    const source = this.getSource(githubRepo, branch);
    const baseContainer = this.getBaseContainer(source, targetDirectory);
    const builtContainer = baseContainer
      .withExec([packageManager, "install", "--frozen-lockfile"])
      .withExec([packageManager, "apibara", "build"]);
    return builtContainer;
  }

  /**
   * Generates project information, sends it to an API endpoint, and returns the info.
   * @param githubRepo The URL of the GitHub repository.
   * @param branch The branch to clone.
   * @param targetDirectory Optional subdirectory where the project resides.
   * @param packageManager The package manager to use ("pnpm" or "npm").
   * @param apiEndpoint URL to POST the project information to.
   * @param apiBearerToken Optional Bearer token for API authorization.
   * @returns A Promise resolving to the project information JSON string.
   */
  @func()
  async generateAndSendProjectInfo(
    githubRepo: string,
    branch: string,
    packageManager: string,
    apiEndpoint: string,
    apiBearerToken?: string,
    targetDirectory?: string,
  ): Promise<string> {
    const builtContainer = this.buildProject(
      githubRepo,
      branch,
      packageManager,
      targetDirectory,
    );

    const containerWithProjectInfoFile = builtContainer.withExec([
      packageManager,
      "apibara",
      "write-project-info",
    ]);

    const projectInfoContents = await containerWithProjectInfoFile
      .file(PROJECT_INFO_FILE_PATH)
      .contents();

    if (apiEndpoint) {
      try {
        await axios.post(
          apiEndpoint,
          {
            buildInfo: projectInfoContents,
          },
          {
            headers: {
              "Content-Type": "application/json",
              ...(apiBearerToken && {
                Authorization: `Bearer ${apiBearerToken}`,
              }),
            },
          },
        );
      } catch (e) {
        console.error("Failed to send project info to API", e);
        throw e;
      }
    } else {
      console.warn("No API endpoint configured. Skipping API call.");
    }
    return projectInfoContents;
  }

  /**
   * Builds a Docker image using the provided source code and a predefined Dockerfile.
   * The Docker build context is set to the targetDirectory if provided, otherwise to the root of the source.
   * @param githubRepo The URL of the GitHub repository.
   * @param branch The branch to clone.
   * @param targetDirectory Optional subdirectory within the source code to be used as the Docker build context.
   * @returns A Container object representing the built Docker image.
   */
  @func()
  buildImage(
    githubRepo: string,
    branch: string,
    targetDirectory?: string,
  ): Container {
    const source = this.getSource(githubRepo, branch);
    const context = targetDirectory
      ? source.directory(targetDirectory)
      : source;
    const contextWithDockerfile = context.withNewFile(
      "Dockerfile.gen",
      dockerFileCode,
    );

    const image = dag.container().build(contextWithDockerfile, {
      dockerfile: "Dockerfile.gen",
    });
    return image;
  }

  /**
   * Orchestrates fetching source, building, generating project info (with API call),
   * building a Docker image, and optionally publishing it.
   * @param githubRepo URL of the GitHub repository.
   * @param dockerImageName Name for the Docker image.
   * @param dockerRegistry Docker registry to publish to (e.g., "docker.io/username").
   * @param registryUsername Username for the Docker registry.
   * @param registryPassword Password for the Docker registry, as a Dagger Secret.
   * @param packageManager The package manager to use ("pnpm" or "npm").
   * @param targetDirectory Optional subdirectory for the Apibara project and Docker build context.
   * @param apiEndpoint URL to POST the project information to.
   * @param gitBranch Optional Git branch to use. Defaults to "main".
   * @param apiBearerToken Optional Bearer token for API authorization for sending project info.
   * @returns A Promise resolving to an object containing projectInfoJson and optionally publishedImageAddress.
   */
  @func()
  async runFullPipeline(
    githubRepo: string,
    dockerImageName: string,
    dockerRegistry: string,
    registryUsername: string,
    registryPassword: Secret,
    packageManager: string,
    apiEndpoint: string,
    gitBranch = "main",
    apiBearerToken?: string,
    targetDirectory?: string,
  ): Promise<Container> {
    // Generate project info and send to API
    // NOTE: This step also implicitly builds the project.
    const projectInfoJson = await this.generateAndSendProjectInfo(
      githubRepo,
      gitBranch,
      packageManager,
      apiEndpoint,
      apiBearerToken,
      targetDirectory,
    );

    const finalImage = this.buildImage(githubRepo, gitBranch, targetDirectory);

    let publishedImageAddress: string | undefined = undefined;

    if (
      registryUsername &&
      registryPassword &&
      dockerRegistry &&
      dockerImageName
    ) {
      const fullImageAddress = `${dockerRegistry}/${dockerImageName}:latest`;

      try {
        const imageToPublish = await finalImage.sync();
        publishedImageAddress = await imageToPublish
          .withRegistryAuth(dockerRegistry, registryUsername, registryPassword)
          .publish(fullImageAddress);
        console.log(
          `Image published successfully to: ${publishedImageAddress}`,
        );
      } catch (e) {
        console.error(`Failed to publish image: ${e}`);
        throw e;
      }
    } else {
      throw new Error("Registry credentials or image details missing");
    }

    return finalImage;
  }

  /**
   * Returns lines that match a pattern in the files of the provided Directory
   */
  @func()
  async grepDir(directoryArg: Directory, pattern: string): Promise<string> {
    return dag
      .container()
      .from("alpine:latest")
      .withMountedDirectory("/mnt", directoryArg)
      .withWorkdir("/mnt")
      .withExec(["grep", "-R", pattern, "."])
      .stdout();
  }
}
