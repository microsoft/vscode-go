FROM golang:1.14 AS gobuilder

ENV GO111MODULE on
ENV GOBIN /gobin
ENV GOPROXY https://proxy.golang.org
RUN cd $(mktemp -d) && go get golang.org/x/tools/gopls@latest

FROM node:latest

# GO111MODULE=auto
RUN mkdir /go
COPY --from=gobuilder /gobin /go/bin
COPY --from=gobuilder /usr/local/go /usr/local/go

# TODO(hyangah): some tests fail if GOPATH is not set. Fix them.
ENV GOPATH=/go
ENV PATH=${GOPATH}/bin:/usr/local/go/bin:${PATH}
ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update && apt-get install -y libnss3 libgtk-3-dev libxss1 libasound2 xvfb libsecret-1-0

# Install other Go tools tests depend on
RUN go get -u -v \
	github.com/acroca/go-symbols \
	github.com/cweill/gotests/... \
  	github.com/davidrjenni/reftools/cmd/fillstruct \
  	github.com/haya14busa/goplay/cmd/goplay \
  	github.com/mdempsky/gocode \
  	github.com/ramya-rao-a/go-outline \
  	github.com/rogpeppe/godef \
  	github.com/sqs/goreturns \
  	github.com/uudashr/gopkgs/v2/cmd/gopkgs \
  	github.com/zmb3/gogetdoc \
  	golang.org/x/lint/golint \
  	golang.org/x/tools/cmd/gorename


WORKDIR /workspace
ENTRYPOINT ["build/all.bash"]
