FROM chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d
# Alpine 3.24 package; retain the pinned Seaweed binary and existing data format.
RUN apk add --no-cache socat=1.8.1.3-r0
COPY apps/community/ops/seaweed/entrypoint.sh apps/community/ops/seaweed/forward-s3.sh /opt/community-seaweed/
ENTRYPOINT ["/opt/community-seaweed/entrypoint.sh"]
