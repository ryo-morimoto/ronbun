{
  description = "ronbun -- a fast, modern browser for academic papers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      version = "0.4.0"; # x-release-please-version

      src = {
        url = "https://registry.npmjs.org/@ronbun/cli/-/cli-${version}.tgz";
        hash = "sha256-yNPq4WCokuMoN9s9yuUV6EPlOD/vUrgUGUDIvPi21Z8=";
      };

      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      mkRonbun =
        pkgs:
        pkgs.stdenv.mkDerivation {
          pname = "ronbun";
          inherit version;

          src = pkgs.fetchurl { inherit (src) url hash; };

          sourceRoot = ".";

          unpackPhase = ''
            mkdir -p source
            tar xzf $src --strip-components=1 -C source
            sourceRoot=source
          '';

          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            mkdir -p $out/bin $out/lib
            cp dist/index.js $out/lib/index.js

            makeWrapper ${pkgs.nodejs}/bin/node $out/bin/ronbun \
              --add-flags $out/lib/index.js
          '';

          meta = {
            description = "CLI for searching and managing academic papers";
            homepage = "https://github.com/ryo-morimoto/ronbun";
            license = pkgs.lib.licenses.mit;
            mainProgram = "ronbun";
            platforms = supportedSystems;
          };
        };
    in
    {
      overlays.default = _final: prev: {
        ronbun = mkRonbun prev;
      };

      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          pkg = mkRonbun pkgs;
        in
        {
          default = pkg;
          cli = pkg;
          skill = pkgs.runCommand "ronbun-skill" { } ''
            mkdir -p $out
            cp ${./SKILL.md} $out/SKILL.md
          '';
        }
      );
    };
}
